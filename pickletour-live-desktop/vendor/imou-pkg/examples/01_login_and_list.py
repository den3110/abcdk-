"""Run once to bootstrap a session, then list cameras."""

from imou import login, Client

# OTP arrives via SMS; the helper will prompt() unless you pass otp_provider=
sess = login(phone="869941629", area_code="84", password="HoangHuyen@0810")
print("Saved session →", sess["regional_host"])

c = Client()
for cam in c.devices():
    print(f"  · {cam.name:24s} {cam.device_id}  ({cam.model})")
