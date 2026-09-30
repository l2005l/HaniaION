from __future__ import annotations

import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

private_key = ec.generate_private_key(ec.SECP256R1())
private_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
).decode().strip()
public_bytes = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.X962,
    format=serialization.PublicFormat.UncompressedPoint,
)
public_key = base64.urlsafe_b64encode(public_bytes).decode().rstrip("=")

print("VAPID_PUBLIC_KEY=")
print(public_key)
print("\nVAPID_PRIVATE_KEY=")
print(private_pem.replace("\n", "\\n"))
