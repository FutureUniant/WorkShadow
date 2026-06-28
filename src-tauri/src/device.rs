use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFingerprint {
    pub machine_id: String,
    pub public_ip: String,
}

#[tauri::command]
pub fn get_device_fingerprint() -> DeviceFingerprint {
    DeviceFingerprint {
        machine_id: read_machine_id(),
        public_ip: read_public_ip(),
    }
}

fn read_machine_id() -> String {
    match machine_uid::get() {
        Ok(id) => {
            let trimmed = id.trim().to_string();
            if trimmed.is_empty() {
                "unknown-device".into()
            } else {
                trimmed
            }
        }
        Err(_) => "unknown-device".into(),
    }
}

fn read_public_ip() -> String {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    for url in [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
    ] {
        if let Ok(resp) = client.get(url).send() {
            if let Ok(text) = resp.text() {
                let ip = text.trim().to_string();
                if !ip.is_empty() {
                    return ip;
                }
            }
        }
    }
    String::new()
}
