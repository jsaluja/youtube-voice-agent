#!/usr/bin/env python3
"""
Setup script for Whisper-enhanced transcript server
"""

import os
import sys
import subprocess

def install_dependencies():
    """Install required Python packages"""
    packages = [
        'yt-dlp',
        'flask',
        'flask-cors', 
        'openai',
        'requests'
    ]
    
    print("📦 Installing Python dependencies...")
    for package in packages:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"✅ {package} installed")
        except subprocess.CalledProcessError:
            print(f"❌ Failed to install {package}")
            
def check_ffmpeg():
    """Check if ffmpeg is installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        print("✅ ffmpeg is installed")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ ffmpeg not found")
        print("📋 Install ffmpeg:")
        print("   • macOS: brew install ffmpeg")
        print("   • Ubuntu: sudo apt install ffmpeg")
        print("   • Windows: Download from https://ffmpeg.org/")
        return False

def setup_api_key():
    """Help setup API key"""
    print("\n🔑 API Key Setup:")
    print("1. Get your SambaNova API key from https://api.sambanova.ai")
    print("2. Edit transcript_server.py and replace 'SAMBANOVA_API_KEY' with your actual key")
    print("3. Or set environment variable: export SAMBANOVA_API_KEY='your-key-here'")

def create_directories():
    """Create required directories"""
    dirs = ['transcripts', 'audio']
    for dir_name in dirs:
        os.makedirs(dir_name, exist_ok=True)
        print(f"📁 Created directory: {dir_name}")

if __name__ == '__main__':
    print("🚀 Setting up Whisper-enhanced YouTube transcript server...")
    
    # Install dependencies
    install_dependencies()
    
    # Check ffmpeg
    ffmpeg_ok = check_ffmpeg()
    
    # Create directories
    create_directories()
    
    # API key setup
    setup_api_key()
    
    print("\n🎯 Setup Summary:")
    print("✅ Python dependencies installed")
    print(f"{'✅' if ffmpeg_ok else '❌'} ffmpeg availability")
    print("📁 Directories created")
    
    if ffmpeg_ok:
        print("\n🎉 Setup complete! Run: python3 transcript_server.py")
    else:
        print("\n⚠️  Install ffmpeg before running the server")