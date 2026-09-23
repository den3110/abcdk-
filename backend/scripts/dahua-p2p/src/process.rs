use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UdpSocket,
    sync::{mpsc, oneshot},
};

use crate::ptcp::{PTCPBody, PTCPEvent, PTCPPayload, PTCPSession, Reassembler, PTCP};

/**
 * Read data from the channel and write it back to the client
 */
pub async fn process_writer(
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    mut rx: mpsc::Receiver<Vec<u8>>,
) {
    while let Some(data) = rx.recv().await {
        if writer.write_all(&data).await.is_err() {
            break;
        }
    }
}

/**
 * Read data from the client and send it to the channel
 */
pub async fn process_reader(
    mut reader: tokio::net::tcp::OwnedReadHalf,
    realm_id: u32,
    dh_tx: mpsc::Sender<PTCPEvent>,
) {
    let mut buf = [0u8; 4096];

    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => {
                let _ = dh_tx.send(PTCPEvent::Disconnect(realm_id)).await;
                break;
            }
            Ok(n) => n,
        };

        if dh_tx
            .send(PTCPEvent::Data(realm_id, buf[0..n].to_vec()))
            .await
            .is_err()
        {
            break;
        }
    }
}

/**
* Read data from client and send it to devices
*/
pub async fn dh_writer(
    session: Arc<Mutex<PTCPSession>>,
    socket: Arc<UdpSocket>,
    mut dh_rx: mpsc::Receiver<PTCPEvent>,
    remote_port: u32,
) {
    while let Some(ev) = dh_rx.recv().await {
        match ev {
            PTCPEvent::Heartbeat => {
                let p = session.lock().unwrap().send(PTCPBody::Heartbeat);
                socket.ptcp_request(p).await;
            }
            PTCPEvent::Connect(realm) => {
                let p = session
                    .lock()
                    .unwrap()
                    .send(PTCPBody::Bind(realm, remote_port));
                socket.ptcp_request(p).await;
            }
            PTCPEvent::Disconnect(realm) => {
                let p = session
                    .lock()
                    .unwrap()
                    .send(PTCPBody::Status(realm, "DISC".to_string()));
                socket.ptcp_request(p).await;
            }
            PTCPEvent::Data(realm, data) => {
                let p = session
                    .lock()
                    .unwrap()
                    .send(PTCPBody::Payload(PTCPPayload { realm, data }));
                socket.ptcp_request(p).await;
            }
        }
    }
}

/**
 * Read data from devices and send it to clients
 */
pub async fn dh_reader(
    session: Arc<Mutex<PTCPSession>>,
    socket: Arc<UdpSocket>,
    channels: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>>,
    conn_channels: Arc<Mutex<HashMap<u32, oneshot::Sender<bool>>>>,
) {
    // Reliable in-order reassembly over PTCP (starts at the offset reached by the
    // handshake). Reorders by byte-offset + holds the ACK at the contiguous point
    // so the device retransmits lost media packets instead of stalling its window.
    let mut reasm = Reassembler::new(session.lock().unwrap().recv_offset());
    loop {
        let packet = socket.ptcp_read().await;
        session.lock().unwrap().set_rmid(packet.lmid());

        if let PTCPBody::Empty = packet.body {
            continue;
        }

        // Reorder; may release 0..N in-order bodies. recv advances only over
        // contiguous bytes.
        let bodies = reasm.push(packet);

        // ACK the current contiguous offset (gap → same ACK → device retransmits).
        {
            let mut s = session.lock().unwrap();
            s.set_recv(reasm.recv);
        }
        let p = session.lock().unwrap().send(PTCPBody::Empty);
        socket.ptcp_request(p).await;

        for body in bodies {
            match body {
                PTCPBody::Status(realm, status) => {
                    if status.starts_with("CONN") {
                        if let Some(tx) = conn_channels.lock().unwrap().remove(&realm) {
                            let _ = tx.send(true);
                        }
                    } else if status.starts_with("DISC") {
                        channels.lock().unwrap().remove(&realm);
                        conn_channels.lock().unwrap().remove(&realm);
                    }
                }
                PTCPBody::Payload(p) => {
                    let tx = channels.lock().unwrap().get(&p.realm).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(p.data).await;
                    }
                }
                _ => {}
            }
        }
    }
}
