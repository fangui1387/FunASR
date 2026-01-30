#!/usr/bin/env python3
import sys
import os

# Change to the correct directory
os.chdir('/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/python/websocket')

# Set up command line args
sys.argv = ['funasr_wss_server.py', '--port', '10095', '--ngpu', '0', '--host', '0.0.0.0']

# Import the server module
print("Starting import...")
try:
    import funasr_wss_server as server
    print(f"Import successful!")
    print(f"Args: host={server.args.host}, port={server.args.port}")
except Exception as e:
    print(f"Import failed: {e}")
    import traceback
    traceback.print_exc()
