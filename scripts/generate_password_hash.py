#!/usr/bin/env python3
"""
Script to generate password hash for authentication
Run: python scripts/generate_password_hash.py
"""

import bcrypt
import getpass

def generate_password_hash():
    """Generate bcrypt hash for password"""
    print("Password Hash Generator for Alpaca Trading App")
    print("=" * 50)
    
    password = getpass.getpass("Enter password: ")
    password_confirm = getpass.getpass("Confirm password: ")
    
    if password != password_confirm:
        print("❌ Passwords do not match!")
        return
    
    # Generate bcrypt hash
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
    
    print("\n✅ Password hash generated successfully!")
    print("\nAdd this to your .env file:")
    print("=" * 50)
    print(f"APP_PASSWORD_HASH={password_hash.decode('utf-8')}")
    print("=" * 50)
    print("\nAlso generate a secure JWT secret key:")
    import secrets
    jwt_secret = secrets.token_urlsafe(32)
    print(f"JWT_SECRET_KEY={jwt_secret}")
    print("=" * 50)

if __name__ == "__main__":
    generate_password_hash()

