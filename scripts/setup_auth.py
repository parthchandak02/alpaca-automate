#!/usr/bin/env python3
"""
Interactive script to generate password hash for authentication
"""
import bcrypt
import secrets
import getpass
import sys

def main():
    print("=" * 60)
    print("🔐 Alpaca Trading App - Password Hash Generator")
    print("=" * 60)
    print()
    
    try:
        password = getpass.getpass("Enter your password: ")
        if not password:
            print("❌ Password cannot be empty!")
            sys.exit(1)
        
        password_confirm = getpass.getpass("Confirm password: ")
        
        if password != password_confirm:
            print("❌ Passwords do not match!")
            sys.exit(1)
        
        # Generate bcrypt hash
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
        
        # Generate JWT secret
        jwt_secret = secrets.token_urlsafe(32)
        
        print()
        print("✅ Password hash generated successfully!")
        print()
        print("=" * 60)
        print("📝 Add these lines to your .env file:")
        print("=" * 60)
        print()
        print(f"APP_PASSWORD_HASH={password_hash.decode('utf-8')}")
        print(f"JWT_SECRET_KEY={jwt_secret}")
        print()
        print("=" * 60)
        print("⚠️  IMPORTANT:")
        print("=" * 60)
        print("1. Add these lines to your .env file")
        print("2. Restart the backend: pm2 restart gtt-backend")
        print("3. Refresh your browser - you should see the login page")
        print()
        
    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

