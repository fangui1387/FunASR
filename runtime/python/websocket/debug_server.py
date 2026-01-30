#!/usr/bin/env python3
"""Debug WebSocket Server"""

import asyncio
import websockets
import json
import numpy as np
import argparse
import ssl

print("Before funasr import", flush=True)
from funasr import AutoModel
print("After funasr import", flush=True)

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument("--host", type=str, default="0.0.0.0")
parser.add_argument("--port", type=int, default=10095)
parser.add_argument("--ngpu", type=int, default=1)
args = parser.parse_args()

print(f"Args: host={args.host}, port={args.port}, ngpu={args.ngpu}", flush=True)

async def handler(websocket):
    """Simple handler"""
    print(f"New connection from {websocket.remote_address}", flush=True)
    try:
        async for message in websocket:
            print(f"Received: {message}", flush=True)
            if isinstance(message, str):
                await websocket.send(json.dumps({"mode": "test", "text": "Echo: " + message}))
    except websockets.ConnectionClosed:
        print("Connection closed", flush=True)
    except Exception as e:
        print(f"Error: {e}", flush=True)

async def main():
    print(f"Starting debug server on ws://{args.host}:{args.port}/", flush=True)
    server = await websockets.serve(handler, args.host, args.port, ping_interval=None)
    print("Server started!", flush=True)
    await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
