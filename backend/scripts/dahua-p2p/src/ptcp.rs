use async_trait::async_trait;
use std::cmp;
use std::sync::OnceLock;
use tokio::net::UdpSocket;

/// Per-packet logging is OFF by default (at 1080p RTP rates the hex-formatting
/// println! flood chokes the async loop → media stalls). Enable with DH_DEBUG=1.
fn dh_debug() -> bool {
    static D: OnceLock<bool> = OnceLock::new();
    *D.get_or_init(|| std::env::var("DH_DEBUG").is_ok())
}

impl PTCPPacket {
    /// Remote message id of this packet (needed by senders to set rmid).
    pub fn lmid(&self) -> u32 {
        self.lmid
    }

    /// Safe parse: returns None on malformed/short packets instead of panicking.
    fn try_parse(data: &[u8]) -> Option<PTCPPacket> {
        if data.len() < 24 || &data[0..4] != b"PTCP" {
            return None;
        }
        let sent = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let recv = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let pid = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
        let lmid = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let rmid = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        let body = PTCPBody::try_parse(&data[24..])?;
        Some(PTCPPacket {
            sent,
            recv,
            pid,
            lmid,
            rmid,
            body,
        })
    }
}

impl PTCPBody {
    /// Safe body parse: returns None instead of panicking on malformed data.
    fn try_parse(data: &[u8]) -> Option<PTCPBody> {
        if data.is_empty() {
            return Some(PTCPBody::Empty);
        }
        if data.len() < 4 {
            return None;
        }
        Some(match data[0] {
            0x00 => PTCPBody::Sync,
            0x10 => {
                if data.len() < 12 {
                    return None;
                }
                let length = (u32::from_be_bytes([data[0], data[1], data[2], data[3]]) & 0xFFFF) as usize;
                let realm = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                let payload = data[12..].to_vec();
                if length != payload.len() {
                    return None;
                }
                PTCPBody::Payload(PTCPPayload { realm, data: payload })
            }
            0x11 => {
                if data.len() < 16 {
                    return None;
                }
                PTCPBody::Bind(
                    u32::from_be_bytes([data[4], data[5], data[6], data[7]]),
                    u32::from_be_bytes([data[12], data[13], data[14], data[15]]),
                )
            }
            0x12 => {
                if data.len() < 12 {
                    return None;
                }
                let realm = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                let status = String::from_utf8_lossy(&data[12..]).to_string();
                PTCPBody::Status(realm, status)
            }
            0x13 => PTCPBody::Heartbeat,
            _ => PTCPBody::Command(data.to_vec()),
        })
    }
}

pub enum PTCPEvent {
    Heartbeat,
    Connect(u32),
    Disconnect(u32),
    Data(u32, Vec<u8>),
}

pub struct PTCPPayload {
    pub realm: u32,
    pub data: Vec<u8>,
}

pub enum PTCPBody {
    Sync,
    Command(Vec<u8>),
    Payload(PTCPPayload),
    Bind(u32, u32),
    Status(u32, String),
    Heartbeat,
    Empty,
}

pub struct PTCPPacket {
    sent: u32,
    recv: u32,
    pid: u32,
    lmid: u32,
    rmid: u32,
    pub body: PTCPBody,
}

impl PTCPPayload {
    fn parse(data: &[u8]) -> PTCPPayload {
        assert!(data.len() >= 12, "Invalid payload");
        assert_eq!(data[0], 0x10, "Invalid header");

        // first 4 bytes it header
        let header = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
        let length = header & 0xFFFF;
        let realm = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let padding = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let data = data[12..].to_vec();

        assert_eq!(padding, 0, "Invalid padding");
        assert_eq!(length, data.len() as u32, "Invalid length");

        PTCPPayload { realm, data }
    }

    fn serialize(&self) -> Vec<u8> {
        let length = self.data.len() as u32;
        let header = 0x10000000 | length;
        let header = header.to_be_bytes();
        let realm = self.realm.to_be_bytes();
        let padding = 0u32.to_be_bytes();

        [
            header.to_vec(),
            realm.to_vec(),
            padding.to_vec(),
            self.data.clone(),
        ]
        .concat()
    }
}

impl std::fmt::Debug for PTCPPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "length: {}, realm: 0x{:08x}, data: [{}{}]",
            self.data.len(),
            self.realm,
            self.data[0..cmp::min(self.data.len(), 16)]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" "),
            if self.data.len() > 16 { " ..." } else { "" },
        )
    }
}

impl std::fmt::Debug for PTCPBody {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PTCPBody::Sync => write!(f, "Sync"),
            PTCPBody::Command(data) => write!(
                f,
                "Command([{}])",
                data.iter()
                    .map(|b| format!("{:02x}", b))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
            PTCPBody::Payload(payload) => write!(f, "{:?}", payload),
            PTCPBody::Bind(realm, port) => {
                write!(f, "Bind {{ realm: 0x{:08x}, port: {} }}", realm, port)
            }
            PTCPBody::Status(realm, status) => {
                write!(f, "Status {{ realm: 0x{:08x}, status: {} }}", realm, status)
            }
            PTCPBody::Heartbeat => write!(f, "Heartbeat"),
            PTCPBody::Empty => write!(f, "Empty"),
        }
    }
}

impl std::fmt::Debug for PTCPPacket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "PTCPPacket {{ sent: {}, recv: {}, pid: 0x{:08x}, lmid: 0x{:08x}, rmid: 0x{:08x}, body: {:?} }}",
            self.sent, self.recv, self.pid, self.lmid, self.rmid, self.body
        )
    }
}

impl PTCPBody {
    fn parse(data: &[u8]) -> PTCPBody {
        if data.len() == 0 {
            return PTCPBody::Empty;
        }

        assert!(data.len() >= 4, "Invalid body");

        match data[0] {
            0x00 => PTCPBody::Sync,
            0x10 => PTCPBody::Payload(PTCPPayload::parse(data)),
            0x11 => PTCPBody::Bind(
                u32::from_be_bytes([data[4], data[5], data[6], data[7]]),
                u32::from_be_bytes([data[12], data[13], data[14], data[15]]),
            ),
            0x12 => {
                let realm = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                let status = String::from_utf8_lossy(&data[12..]).to_string();
                PTCPBody::Status(realm, status)
            }
            0x13 => PTCPBody::Heartbeat,
            _ => PTCPBody::Command(data.to_vec()),
        }
    }

    fn serialize(&self) -> Vec<u8> {
        match self {
            PTCPBody::Sync => b"\x00\x03\x01\x00".to_vec(),
            PTCPBody::Command(data) => data.to_vec(),
            PTCPBody::Payload(payload) => payload.serialize(),
            PTCPBody::Bind(realm, port) => [
                b"\x11\x00\x00\x00".to_vec(),
                realm.to_be_bytes().to_vec(),
                b"\x00\x00\x00\x00".to_vec(),
                port.to_be_bytes().to_vec(),
                b"\x7f\x00\x00\x01".to_vec(),
            ]
            .concat(),
            PTCPBody::Status(realm, status) => [
                b"\x12\x00\x00\x00".to_vec(),
                realm.to_be_bytes().to_vec(),
                b"\x00\x00\x00\x00".to_vec(),
                status.as_bytes().to_vec(),
            ]
            .concat(),
            PTCPBody::Heartbeat => b"\x13\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec(),
            PTCPBody::Empty => Vec::new(),
        }
    }

    fn len(&self) -> usize {
        match self {
            PTCPBody::Sync => 4,
            PTCPBody::Command(data) => data.len(),
            PTCPBody::Payload(payload) => payload.data.len() + 12,
            PTCPBody::Bind(_, _) => 20,
            PTCPBody::Status(_, status) => status.len() + 12,
            PTCPBody::Heartbeat => 12,
            PTCPBody::Empty => 0,
        }
    }
}

impl PTCPPacket {
    fn parse(data: &[u8]) -> PTCPPacket {
        assert!(data.len() >= 24, "Invalid packet");

        let magic = &data[0..4];

        assert_eq!(magic, b"PTCP", "Invalid magic");

        let sent = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let recv = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let pid = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
        let lmid = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let rmid = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        let body = PTCPBody::parse(&data[24..]);

        PTCPPacket {
            sent,
            recv,
            pid,
            lmid,
            rmid,
            body,
        }
    }

    fn serialize(&self) -> Vec<u8> {
        [
            b"PTCP".to_vec(),
            self.sent.to_be_bytes().to_vec(),
            self.recv.to_be_bytes().to_vec(),
            self.pid.to_be_bytes().to_vec(),
            self.lmid.to_be_bytes().to_vec(),
            self.rmid.to_be_bytes().to_vec(),
            self.body.serialize(),
        ]
        .concat()
    }

    fn try_print_data(&self) {
        if let PTCPBody::Payload(p) = &self.body {
            if p.data.len() > 4 && p.data.iter().all(|b| *b < 0x80) {
                println!("{}", String::from_utf8_lossy(&p.data));
            }
        }
    }
}

pub struct PTCPSession {
    sent: u32,
    recv: u32,
    count: u32,
    id: u32,
    rmid: u32,
}

impl PTCPSession {
    pub fn new() -> PTCPSession {
        PTCPSession {
            sent: 0,
            recv: 0,
            count: 0,
            id: 0,
            rmid: 0,
        }
    }

    pub fn send(&mut self, body: PTCPBody) -> PTCPPacket {
        let sent = self.sent;
        let recv = self.recv;
        let pid = match body {
            PTCPBody::Sync => 0x0002FFFF,
            _ => 0x0000FFFF - self.count,
        };
        let lmid = self.id;
        let rmid = self.rmid;

        /*
         * Update counters
         */
        self.sent += body.len() as u32;

        self.id += 1;
        self.count += match body {
            PTCPBody::Sync => 0,
            PTCPBody::Empty => 0,
            _ => 1,
        };

        PTCPPacket {
            sent,
            recv,
            pid,
            lmid,
            rmid,
            body,
        }
    }

    pub fn recv(&mut self, packet: PTCPPacket) -> PTCPPacket {
        self.recv += packet.body.len() as u32;
        self.rmid = packet.lmid;

        packet
    }

    /// Current contiguous received-byte offset (ACK point).
    pub fn recv_offset(&self) -> u32 {
        self.recv
    }
    /// Override the received offset (used by the reassembler for contiguous ACKs).
    pub fn set_recv(&mut self, v: u32) {
        self.recv = v;
    }
    /// Track the remote message id from a received packet (needed for our sends).
    pub fn set_rmid(&mut self, v: u32) {
        self.rmid = v;
    }
}

/// Reliable in-order reassembly over PTCP (PhonyTCP). PTCP is UDP-based with no
/// ordering/retransmit in the PoC, so a 1080p media burst loses packets → the
/// device stalls its send window waiting for a contiguous ACK. This reorders by
/// each packet's `sent` byte-offset and only advances `recv` over contiguous
/// bytes, so our ACK holds at the gap and the device retransmits the missing
/// packet — restoring a clean, sustained stream.
pub struct Reassembler {
    pub recv: u32,
    reorder: std::collections::BTreeMap<u32, (u32, PTCPBody)>,
}

impl Reassembler {
    pub fn new(recv0: u32) -> Reassembler {
        Reassembler {
            recv: recv0,
            reorder: std::collections::BTreeMap::new(),
        }
    }

    /// Feed a received packet; returns the bodies now deliverable IN ORDER.
    pub fn push(&mut self, packet: PTCPPacket) -> Vec<PTCPBody> {
        let mut out = Vec::new();
        let off = packet.sent;
        let flen = packet.body.len() as u32;
        // Zero-length frames (Empty/pure-ack) carry no stream bytes.
        if flen == 0 {
            return out;
        }
        // Already-delivered (retransmit/dup) → drop.
        if off < self.recv {
            return out;
        }
        // Bound memory: ignore absurdly far-future offsets.
        if off.wrapping_sub(self.recv) > 8 * 1024 * 1024 {
            return out;
        }
        self.reorder.entry(off).or_insert((flen, packet.body));
        // Drain contiguous run.
        loop {
            let next = self.reorder.keys().next().copied();
            match next {
                Some(o) if o == self.recv => {
                    let (fl, body) = self.reorder.remove(&o).unwrap();
                    self.recv = self.recv.wrapping_add(fl);
                    out.push(body);
                }
                Some(o) if o < self.recv => {
                    self.reorder.remove(&o);
                }
                _ => break,
            }
        }
        out
    }
}

#[async_trait]
pub trait PTCP {
    async fn ptcp_request(&self, packet: PTCPPacket);
    async fn ptcp_read(&self) -> PTCPPacket;
}

#[async_trait]
impl PTCP for UdpSocket {
    async fn ptcp_request(&self, packet: PTCPPacket) {
        if dh_debug() {
            println!(">>> {:?}", packet);
            packet.try_print_data();
        }
        let bytes = packet.serialize();
        // Ignore transient send errors — the read loop / heartbeat will recover.
        let _ = self.send(&bytes).await;
    }

    async fn ptcp_read(&self) -> PTCPPacket {
        // Loop until a valid packet arrives; skip malformed datagrams instead of
        // panicking (relay can deliver stray/short packets under load).
        let mut buf = vec![0u8; 65535];
        loop {
            let n = match self.recv(&mut buf).await {
                Ok(n) => n,
                Err(_) => {
                    // transient recv error → yield an Empty packet so caller continues
                    return PTCPPacket {
                        sent: 0,
                        recv: 0,
                        pid: 0,
                        lmid: 0,
                        rmid: 0,
                        body: PTCPBody::Empty,
                    };
                }
            };
            if let Some(packet) = PTCPPacket::try_parse(&buf[0..n]) {
                if dh_debug() {
                    println!("<<< {:?}", packet);
                    packet.try_print_data();
                }
                return packet;
            }
            // malformed → skip and read next
        }
    }
}
