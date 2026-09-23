use async_trait::async_trait;
use base64::Engine;
use sha1::Digest;
use std::{collections::HashMap, net::SocketAddrV4};
use tokio::{net::UdpSocket, time};
use xml::reader::{EventReader, XmlEvent};

use crate::ptcp::{PTCPBody, PTCPSession, PTCP};

use hmac::{Hmac, Mac};
use md5::Md5;
use ofb::cipher::{KeyIvInit, StreamCipher};
use ofb::Ofb;
use sha2::Sha256;

static AUTH_IV: &[u8] = b"2z52*lk9o6HRyJrf";
static INFO_KEY: &[u8] = b"kRjmsUB&ezmdGLL67H#$ojw@XflcaIaf";
static INFO_IV: &[u8] = b"MydvJw*Iw1w&i^kk";
type Aes256Ofb = Ofb<aes::Aes256>;

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn dev_key(username: &str, password: &str, randsalt: &str) -> Vec<u8> {
    let s = format!("{}:Login to {}:{}", username, randsalt, password);
    let mut h = Md5::new();
    h.update(s.as_bytes());
    h.finalize()
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()
        .into_bytes()
}

fn pbkdf2_dk(key: &[u8], nonce: u32) -> [u8; 32] {
    let mut dk = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(key, nonce.to_string().as_bytes(), 20000, &mut dk);
    dk
}

fn aes_ofb(key: &[u8], iv: &[u8], data: &[u8]) -> Vec<u8> {
    let mut buf = data.to_vec();
    let mut c = Aes256Ofb::new_from_slices(key, iv).unwrap();
    c.apply_keystream(&mut buf);
    buf
}

fn enc_laddr(dk: &[u8], laddr: &str) -> String {
    b64(&aes_ofb(dk, AUTH_IV, laddr.as_bytes()))
}

fn dev_auth(key: &[u8], nonce: u32, curdate: i64, payload: &str) -> String {
    let msg = format!("{}{}{}", nonce, curdate, payload);
    let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
    mac.update(msg.as_bytes());
    b64(&mac.finalize().into_bytes())
}

fn auth_xml(devauth: &str, nonce: u32, curdate: i64, randsalt: &str, username: &str) -> String {
    let salt = if randsalt.is_empty() {
        String::new()
    } else {
        format!("<RandSalt>{}</RandSalt>", randsalt)
    };
    format!(
        "<CreateDate>{}</CreateDate><DevAuth>{}</DevAuth><Nonce>{}</Nonce>{}<UserName>{}</UserName>",
        curdate, devauth, nonce, salt, username
    )
}

fn extract_randsalt(info_b64: &str) -> String {
    if info_b64.is_empty() {
        return String::new();
    }
    let raw = match base64::engine::general_purpose::STANDARD.decode(info_b64) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    let dec = aes_ofb(INFO_KEY, INFO_IV, &raw);
    let s = String::from_utf8_lossy(&dec);
    if let Some(i) = s.find("\"randsalt\"") {
        let rest = &s[i + "\"randsalt\"".len()..];
        if let Some(c) = rest.find(':') {
            let r3 = rest[c + 1..].trim_start().trim_start_matches('"');
            if let Some(end) = r3.find('"') {
                return r3[..end].to_string();
            }
        }
    }
    String::new()
}

static MAIN_SERVER: &str = "www.easy4ipcloud.com:8800";

static USERNAME: &str = "cba1b29e32cb17aa46b8ff9e73c7f40b";
static USERKEY: &str = "996103384cdf19179e19243e959bbf8b";

fn ip_to_bytes(ip: &str) -> Vec<u8> {
    let addr: SocketAddrV4 = ip.parse().unwrap();
    let ip = addr.ip().octets();
    let port = addr.port();

    let mut bytes = Vec::new();
    bytes.extend_from_slice(&port.to_be_bytes());
    bytes.extend_from_slice(&ip);

    bytes.iter().map(|b| !b).collect()
}

pub async fn p2p_handshake(
    socket: UdpSocket,
    serial: String,
    relay_mode: bool,
    username: Option<String>,
    password: Option<String>,
) -> (UdpSocket, PTCPSession) {
    let mut cseq = 0;

    socket.connect(MAIN_SERVER).await.unwrap();

    socket.dh_request("/probe/p2psrv", None, &mut cseq).await;
    socket.dh_read().await;

    socket
        .dh_request(
            format!("/online/p2psrv/{}", serial).as_ref(),
            None,
            &mut cseq,
        )
        .await;
    let p2psrv = &socket.dh_read().await.body.unwrap()["body/US"];

    socket.dh_request("/online/relay", None, &mut cseq).await;
    let relay = &socket.dh_read().await.body.unwrap()["body/Address"];

    let socket2 = UdpSocket::bind("0.0.0.0:0").await.unwrap();
    socket2.connect(p2psrv).await.unwrap();

    socket2
        .dh_request(
            format!("/probe/device/{}", serial).as_ref(),
            None,
            &mut cseq,
        )
        .await;
    socket2.dh_read().await;

    socket2
        .dh_request(
            format!("/info/device/{}", serial).as_ref(),
            None,
            &mut cseq,
        )
        .await;
    let info_resp = socket2.dh_read().await;
    let randsalt = info_resp
        .body
        .as_ref()
        .and_then(|b| b.get("body/Info"))
        .map(|s| extract_randsalt(s))
        .unwrap_or_default();

    let have_auth = username.is_some() && password.is_some();
    let dkey = if have_auth {
        dev_key(
            username.as_deref().unwrap(),
            password.as_deref().unwrap(),
            &randsalt,
        )
    } else {
        Vec::new()
    };
    let auth_nonce: u32 = rand::random::<u32>() & 0x7fff_ffff;
    if have_auth {
        eprintln!("Device auth: randsalt={} (len {})", randsalt, randsalt.len());
    }

    let cid: [u8; 8] = rand::random();

    let p2p_body = if have_auth {
        let curdate = chrono::Utc::now().timestamp();
        let laddr = format!("127.0.0.1:{}", socket.local_addr().unwrap().port());
        let dk = pbkdf2_dk(&dkey, auth_nonce);
        let laddr_enc = enc_laddr(&dk, &laddr);
        let da = dev_auth(&dkey, auth_nonce, curdate, &laddr_enc);
        let auth = auth_xml(&da, auth_nonce, curdate, &randsalt, username.as_deref().unwrap());
        format!(
            "<body>{}<Identify>{}</Identify><IpEncrptV2>true</IpEncrptV2><LocalAddr>{}</LocalAddr><version>5.0.0</version></body>",
            auth,
            cid.iter().map(|b| format!("{:x}", b)).collect::<Vec<_>>().join(" "),
            laddr_enc,
        )
    } else {
        format!(
            "<body><Identify>{}</Identify><IpEncrpt>true</IpEncrpt><LocalAddr>127.0.0.1:{}</LocalAddr><version>5.0.0</version></body>",
            cid.iter().map(|b| format!("{:x}", b)).collect::<Vec<_>>().join(" "),
            socket.local_addr().unwrap().port(),
        )
    };
    socket
        .dh_request(
            format!("/device/{}/p2p-channel", serial).as_ref(),
            Some(p2p_body.as_ref()),
            &mut cseq,
        )
        .await;

    socket2.connect(relay).await.unwrap();

    socket2.dh_request("/relay/agent", None, &mut cseq).await;
    let data = socket2.dh_read().await.body.unwrap();
    let token = &data["body/Token"];
    let agent = &data["body/Agent"];

    socket2.connect(agent).await.unwrap();

    socket2
        .dh_request(
            format!("/relay/start/{}", token).as_ref(),
            Some("<body><Client>:0</Client></body>"),
            &mut cseq,
        )
        .await;
    socket2.dh_read().await;

    let mut res = socket.dh_read_raw().await;

    if res.code == 100 {
        res = socket.dh_read_raw().await;
    }

    if res.code >= 400 {
        if res.code == 403 {
            println!("Device requires authentication when creating P2P channel.");
            println!("Authentication is not supported at this time.");
        }

        panic!("Error response: {}", res.status);
    }

    let data = res.body.unwrap();
    // With IpEncrptV2 (auth), the device returns its LocalAddr AES-256-OFB encrypted
    // (same dk as our laddr). Decrypt like Python get_dec; PubAddr stays plaintext.
    let device_laddr: String = if have_auth {
        let dk = pbkdf2_dk(&dkey, auth_nonce);
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&data["body/LocalAddr"])
            .unwrap_or_default();
        String::from_utf8_lossy(&aes_ofb(&dk, AUTH_IV, &raw)).to_string()
    } else {
        data["body/LocalAddr"].clone()
    };
    let device = &data["body/PubAddr"];

    // not necessary when relay_mode is true, but UDP is connectionless
    socket.connect(device).await.unwrap();

    socket2.connect(MAIN_SERVER).await.unwrap();

    let relay_body = if have_auth {
        let curdate = chrono::Utc::now().timestamp();
        let da = dev_auth(&dkey, auth_nonce, curdate, "");
        let auth = auth_xml(&da, auth_nonce, curdate, &randsalt, username.as_deref().unwrap());
        format!("<body>{}<agentAddr>{}</agentAddr></body>", auth, agent)
    } else {
        format!("<body><agentAddr>{}</agentAddr></body>", agent)
    };
    socket2
        .dh_request(
            format!("/device/{}/relay-channel", serial).as_ref(),
            Some(relay_body.as_ref()),
            &mut cseq,
        )
        .await;

    socket2.connect(agent).await.unwrap();
    // TODO check timeout
    socket2.dh_read().await;

    let mut session = PTCPSession::new();

    socket2.ptcp_request(session.send(PTCPBody::Sync)).await;
    session.recv(socket2.ptcp_read().await);

    if relay_mode {
        return (socket2, session);
    }

    socket2
        .ptcp_request(session.send(PTCPBody::Command(
            b"\x17\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec(),
        )))
        .await;
    let mut res = session.recv(socket2.ptcp_read().await);

    while let PTCPBody::Empty = res.body {
        res = session.recv(socket2.ptcp_read().await);
    }

    let sign = match res.body {
        PTCPBody::Command(ref c) => &c[12..],
        _ => panic!("Invalid response"),
    };

    println!(
        "Sign: {}",
        sign.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join("")
    );

    let cookie: [u8; 4] = rand::random();
    let trans_id: [u8; 12] = rand::random();
    let cid: Vec<u8> = cid.iter().map(|b| !b).collect();

    println!(">>> {}", socket.peer_addr().unwrap());
    let data = [
        b"\xff\xfe\xff\xe7".to_vec(),
        cookie.to_vec(),
        trans_id.to_vec(),
        b"\x7f\xd5\xff\xf7".to_vec(),
        cid.clone(),
        b"\xff\xfb\xff\xf7\xff\xfe".to_vec(),
        ip_to_bytes(&device),
    ]
    .concat();
    println!(
        "Raw [{}]",
        data.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(" ")
    );
    socket.send(&data).await.unwrap();
    println!("---");

    println!("<<< {}", socket.peer_addr().unwrap());
    let mut buf = [0u8; 4096];

    let result = time::timeout(time::Duration::from_secs(5), socket.recv(&mut buf)).await;

    if result.is_err() {
        println!("Timeout occurred while waiting for a response from the device.");
        println!(
            "If the issue persists, you may need to use relay mode (--relay) with this device."
        );
        panic!("Timeout");
    }

    let n = result.unwrap().unwrap();
    println!(
        "Raw [{}]",
        buf[0..n]
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(" ")
    );
    println!("---");

    let rtrans_id = &buf[8..20];

    println!(">>> {}", socket.peer_addr().unwrap());
    let data = [
        b"\xfe\xfe\xff\xe7".to_vec(),
        cookie.to_vec(),
        rtrans_id.to_vec(),
        b"\x7f\xd6\xff\xf7".to_vec(),
        cid.clone(),
        b"\xff\xfb\xff\xf7\xff\xfe".to_vec(),
        ip_to_bytes(&device_laddr),
    ]
    .concat();
    println!(
        "Raw [{}]",
        data.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(" ")
    );
    socket.send(&data).await.unwrap();
    println!("---");

    // read 5 times
    for _ in 0..5 {
        println!("<<< {}", socket.peer_addr().unwrap());
        let n = socket.recv(&mut buf).await.unwrap();
        println!(
            "Raw [{}]",
            buf[0..n]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" ")
        );
        println!("---");
    }

    let mut session = PTCPSession::new();

    socket.ptcp_request(session.send(PTCPBody::Sync)).await;
    let mut res = session.recv(socket.ptcp_read().await);
    assert!(matches!(res.body, PTCPBody::Sync), "Invalid response");

    socket
        .ptcp_request(
            session.send(PTCPBody::Command(
                [
                    b"\x19\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec(),
                    sign.to_vec(),
                ]
                .concat(),
            )),
        )
        .await;

    res = session.recv(socket.ptcp_read().await);
    while let PTCPBody::Empty = res.body {
        res = session.recv(socket.ptcp_read().await);
    }
    match res.body {
        PTCPBody::Command(ref c) => {
            assert_eq!(c[0], 0x1A, "Invalid response");
        }
        _ => panic!("Invalid response"),
    }

    socket
        .ptcp_request(session.send(PTCPBody::Command(
            b"\x1b\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec(),
        )))
        .await;
    res = session.recv(socket.ptcp_read().await);

    assert!(matches!(res.body, PTCPBody::Empty), "Invalid response");

    (socket, session)
}

#[derive(Debug)]
#[allow(dead_code)]
struct DHResponse {
    version: String,
    code: u16,
    status: String,
    headers: HashMap<String, String>,
    body: Option<HashMap<String, String>>,
}

impl DHResponse {
    fn parse_body(body: &str) -> HashMap<String, String> {
        // XmlBody::Value("")
        let mut parser = EventReader::from_str(body);
        let mut stack = Vec::new();
        let mut tree = HashMap::new();

        loop {
            match parser.next() {
                Ok(XmlEvent::StartElement { name, .. }) => {
                    stack.push(name.local_name);
                }
                Ok(XmlEvent::EndElement { .. }) => {
                    stack.pop().unwrap();
                }
                Ok(XmlEvent::Characters(s)) => {
                    let key = stack.as_slice().join("/");
                    tree.insert(key, s);
                }
                Ok(XmlEvent::EndDocument) => {
                    break;
                }
                Err(e) => panic!("Error: {}", e),
                _ => {}
            }
        }

        tree
    }

    fn parse_response(res: &str) -> DHResponse {
        // split head and body by "\r\n\r\n"
        let mut parts = res.split("\r\n\r\n");
        let head = parts.next().unwrap();
        let body = parts.next().unwrap();

        let mut head_parts = head.split("\r\n");
        let mut status_line = head_parts.next().unwrap().split(" ");
        let version = status_line.next().unwrap().to_string();
        let code = status_line.next().unwrap().parse::<u16>().unwrap();
        let status = status_line.next().unwrap().to_string();

        let mut headers = HashMap::new();
        for line in head_parts {
            let mut parts = line.split(": ");
            let key = parts.next().unwrap().to_string();
            let value = parts.next().unwrap().to_string();
            headers.insert(key, value);
        }

        let body = match body.trim().len() {
            0 => None,
            _ => Some(DHResponse::parse_body(body)),
        };

        DHResponse {
            version,
            code,
            status,
            headers,
            body,
        }
    }
}

#[async_trait]
trait DHP2P {
    async fn dh_request(&self, path: &str, body: Option<&str>, seq: &mut u32);
    async fn dh_read_raw(&self) -> DHResponse;

    async fn dh_read(&self) -> DHResponse {
        let res = self.dh_read_raw().await;

        assert!(res.code < 300, "Error response: {}", res.status);

        res
    }
}

#[async_trait]
impl DHP2P for UdpSocket {
    async fn dh_request(&self, path: &str, body: Option<&str>, seq: &mut u32) {
        let method = match body {
            Some(_) => "DHPOST",
            None => "DHGET",
        };

        let body = match body {
            Some(s) => s,
            None => "",
        };

        // random a 32-bit number
        let nonce = rand::random::<u32>();
        // iso8601 time string
        let currdate = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let pwd = format!("{}{}DHP2P:{}:{}", nonce, currdate, USERNAME, USERKEY);

        // sha1 then base64
        let mut hasher = sha1::Sha1::new();
        hasher.update(pwd);
        let hash_digest = hasher.finalize();
        let digest = base64::engine::general_purpose::STANDARD.encode(&hash_digest);

        *seq += 1;

        let req = format!("\
            {} {} HTTP/1.1\r\n\
            CSeq: {}\r\n\
            Authorization: WSSE profile=\"UsernameToken\"\r\n\
            X-WSSE: UsernameToken Username=\"{}\", PasswordDigest=\"{}\", Nonce=\"{}\", Created=\"{}\"\r\n\r\n{}",
            method, path, seq, USERNAME, digest, nonce, currdate, body,
        );

        println!(">>> {}", self.peer_addr().unwrap());
        println!("{}", req);
        println!("---");

        self.send(req.as_bytes()).await.unwrap();
    }

    async fn dh_read_raw(&self) -> DHResponse {
        println!("### {}", self.peer_addr().unwrap());

        let mut buf = [0u8; 4096];
        let n = self.recv(&mut buf).await.unwrap();
        let res = String::from_utf8_lossy(&buf[0..n]);

        println!("<<< {}", self.peer_addr().unwrap());
        println!("{}", res);
        println!("---");

        let res = DHResponse::parse_response(&res);
        println!("{:?}", res);

        res
    }
}
