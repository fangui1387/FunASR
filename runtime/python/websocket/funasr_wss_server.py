#!/usr/bin/env python3
"""
FunASR WebSocket Server
Compatible with websockets 11.0.3
"""

import asyncio
import json
import websockets
import numpy as np
import argparse
import ssl
import sys

print("Starting FunASR WebSocket Server...", flush=True)

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument("--host", type=str, default="0.0.0.0", help="host ip")
parser.add_argument("--port", type=int, default=10095, help="server port")
parser.add_argument("--asr_model", type=str, default="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch")
parser.add_argument("--asr_model_revision", type=str, default="v2.0.4")
parser.add_argument("--asr_model_online", type=str, default="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online")
parser.add_argument("--asr_model_online_revision", type=str, default="v2.0.4")
parser.add_argument("--vad_model", type=str, default="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch")
parser.add_argument("--vad_model_revision", type=str, default="v2.0.4")
parser.add_argument("--punc_model", type=str, default="iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727")
parser.add_argument("--punc_model_revision", type=str, default="v2.0.4")
parser.add_argument("--ngpu", type=int, default=1, help="0 for cpu, 1 for gpu")
parser.add_argument("--device", type=str, default="cuda", help="cuda or cpu")
parser.add_argument("--ncpu", type=int, default=4, help="cpu cores")
parser.add_argument("--certfile", type=str, default="", help="SSL cert file")
parser.add_argument("--keyfile", type=str, default="", help="SSL key file")
args = parser.parse_args()

print(f"Args parsed: host={args.host}, port={args.port}, ngpu={args.ngpu}", flush=True)

# Global variables
websocket_users = set()
model_asr = None
model_asr_streaming = None
model_vad = None
model_punc = None
models_loaded = False


def load_models():
    """Load all models - called on first connection"""
    global model_asr, model_asr_streaming, model_vad, model_punc, models_loaded
    
    if models_loaded:
        return
    
    print("Loading models...", flush=True)
    from funasr import AutoModel

    # Load ASR model
    model_asr = AutoModel(
        model=args.asr_model,
        model_revision=args.asr_model_revision,
        ngpu=args.ngpu,
        ncpu=args.ncpu,
        device=args.device,
        disable_pbar=True,
        disable_log=True,
    )
    
    # Load online ASR model
    model_asr_streaming = AutoModel(
        model=args.asr_model_online,
        model_revision=args.asr_model_online_revision,
        ngpu=args.ngpu,
        ncpu=args.ncpu,
        device=args.device,
        disable_pbar=True,
        disable_log=True,
    )
    
    # Load VAD model
    model_vad = AutoModel(
        model=args.vad_model,
        model_revision=args.vad_model_revision,
        ngpu=args.ngpu,
        ncpu=args.ncpu,
        device=args.device,
        disable_pbar=True,
        disable_log=True,
    )

    # Load punctuation model
    if args.punc_model != "":
        model_punc = AutoModel(
            model=args.punc_model,
            model_revision=args.punc_model_revision,
            ngpu=args.ngpu,
            ncpu=args.ncpu,
            device=args.device,
            disable_pbar=True,
            disable_log=True,
        )
    else:
        model_punc = None
    
    models_loaded = True
    print("Models loaded!", flush=True)


async def process_vad(websocket, audio_in):
    """Process VAD"""
    segments_result = model_vad.generate(
        input=audio_in, **websocket.status_dict_vad
    )[0]["value"]
    
    speech_start = -1
    speech_end = -1
    
    if len(segments_result) == 1:
        if segments_result[0][0] != -1:
            speech_start = segments_result[0][0]
        if segments_result[0][1] != -1:
            speech_end = segments_result[0][1]
    
    return speech_start, speech_end


async def process_asr_offline(websocket, audio_in):
    """Process offline ASR"""
    if len(audio_in) == 0:
        return
    
    rec_result = model_asr.generate(input=audio_in, **websocket.status_dict_asr)[0]
    
    # Apply punctuation if available
    if model_punc and len(rec_result.get("text", "")) > 0:
        rec_result = model_punc.generate(
            input=rec_result["text"], **websocket.status_dict_punc
        )[0]
    
    if len(rec_result.get("text", "")) > 0:
        mode = "2pass-offline" if "2pass" in websocket.mode else websocket.mode
        # offline 模式下，结果总是最终的
        is_final = True if websocket.mode == "offline" else websocket.is_speaking
        message = json.dumps({
            "mode": mode,
            "text": rec_result["text"],
            "wav_name": websocket.wav_name,
            "is_final": is_final,
        })
        await websocket.send(message)


async def process_asr_online(websocket, audio_in):
    """Process online ASR"""
    if len(audio_in) == 0:
        return
    
    rec_result = model_asr_streaming.generate(
        input=audio_in, **websocket.status_dict_asr_online
    )[0]
    
    if len(rec_result.get("text", "")) > 0:
        mode = "2pass-online" if "2pass" in websocket.mode else websocket.mode
        message = json.dumps({
            "mode": mode,
            "text": rec_result["text"],
            "wav_name": websocket.wav_name,
            "is_final": websocket.is_speaking,
        })
        await websocket.send(message)


async def ws_serve(websocket):
    """WebSocket connection handler"""
    global websocket_users
    
    print(f"New connection from {websocket.remote_address}", flush=True)
    
    # Load models on first connection
    if not models_loaded:
        try:
            load_models()
        except Exception as e:
            print(f"Error loading models: {e}", flush=True)
            await websocket.close()
            return
    
    websocket_users.add(websocket)
    
    # Initialize status
    websocket.status_dict_asr = {}
    websocket.status_dict_asr_online = {"cache": {}, "is_final": False, "chunk_size": [5, 10, 5]}
    websocket.status_dict_vad = {"cache": {}, "is_final": False}
    websocket.status_dict_punc = {"cache": {}} if model_punc else {}
    websocket.chunk_interval = 10
    websocket.vad_pre_idx = 0
    websocket.wav_name = "microphone"
    websocket.mode = "2pass"
    websocket.is_speaking = True
    speech_start = False
    speech_end_i = -1
    frames = []
    frames_asr = []
    frames_asr_online = []

    try:
        async for message in websocket:
            if isinstance(message, str):
                # Handle JSON messages
                try:
                    messagejson = json.loads(message)
                    print(f"Received JSON: {messagejson}", flush=True)
                    
                    # 处理心跳 ping
                    if messagejson.get("type") == "ping":
                        await websocket.send(json.dumps({"type": "pong"}))
                        continue
                    
                    if "is_speaking" in messagejson:
                        websocket.is_speaking = messagejson["is_speaking"]
                        websocket.status_dict_asr_online["is_final"] = not websocket.is_speaking
                        print(f"is_speaking changed to: {websocket.is_speaking}", flush=True)
                        
                        # 当 is_speaking 变为 False 时，立即处理离线 ASR
                        if not websocket.is_speaking and frames_asr:
                            print(f"Processing offline ASR on is_speaking=False, frames_asr: {len(frames_asr)}", flush=True)
                            if websocket.mode in ["2pass", "offline"]:
                                audio_in = b"".join(frames_asr)
                                print(f"Audio data length for ASR: {len(audio_in)} bytes", flush=True)
                                try:
                                    await process_asr_offline(websocket, audio_in)
                                except Exception as e:
                                    print(f"Error in ASR offline: {e}", flush=True)
                            
                            frames_asr = []
                            speech_start = False
                            frames_asr_online = []
                            websocket.status_dict_asr_online["cache"] = {}
                            websocket.vad_pre_idx = 0
                            frames = []
                            websocket.status_dict_vad["cache"] = {}
                    
                    if "chunk_interval" in messagejson:
                        websocket.chunk_interval = messagejson["chunk_interval"]
                    if "wav_name" in messagejson:
                        websocket.wav_name = messagejson.get("wav_name")
                    if "chunk_size" in messagejson:
                        chunk_size = messagejson["chunk_size"]
                        if isinstance(chunk_size, str):
                            chunk_size = chunk_size.split(",")
                        websocket.status_dict_asr_online["chunk_size"] = [int(x) for x in chunk_size]
                    if "hotwords" in messagejson:
                        websocket.status_dict_asr["hotword"] = messagejson["hotwords"]
                    if "mode" in messagejson:
                        websocket.mode = messagejson["mode"]
                except json.JSONDecodeError:
                    print(f"Invalid JSON: {message}", flush=True)
                    continue

            # Process binary audio data
            if not isinstance(message, str):
                print(f"Received audio data: {len(message)} bytes", flush=True)
                frames.append(message)
                # 所有音频数据都进入 frames_asr，不依赖 VAD
                frames_asr.append(message)
                duration_ms = len(message) // 32
                websocket.vad_pre_idx += duration_ms

                # Add to online ASR frames
                frames_asr_online.append(message)
                websocket.status_dict_asr_online["is_final"] = speech_end_i != -1
                
                # Process online ASR
                if (len(frames_asr_online) % websocket.chunk_interval == 0 or 
                    websocket.status_dict_asr_online["is_final"]):
                    if websocket.mode in ["2pass", "online"]:
                        audio_in = b"".join(frames_asr_online)
                        try:
                            await process_asr_online(websocket, audio_in)
                        except Exception as e:
                            print(f"Error in ASR streaming: {e}", flush=True)
                    frames_asr_online = []
                
                # VAD processing (optional, for detecting speech segments)
                try:
                    speech_start_i, speech_end_i = await process_vad(websocket, message)
                except Exception as e:
                    print(f"Error in VAD: {e}", flush=True)
                
                if speech_start_i != -1:
                    speech_start = True
                
                if speech_end_i != -1:
                    speech_start = False
                
                # Process offline ASR only when VAD detects speech end
                # Don't process here based on is_speaking - that's handled in JSON message handler
                if speech_end_i != -1:
                    print(f"Processing offline ASR on VAD end, frames_asr: {len(frames_asr)}", flush=True)
                    if websocket.mode in ["2pass", "offline"]:
                        audio_in = b"".join(frames_asr)
                        print(f"Audio data length for ASR: {len(audio_in)} bytes", flush=True)
                        try:
                            await process_asr_offline(websocket, audio_in)
                        except Exception as e:
                            print(f"Error in ASR offline: {e}", flush=True)
                    
                    frames_asr = []
                    speech_start = False
                    frames_asr_online = []
                    websocket.status_dict_asr_online["cache"] = {}
                    frames = frames[-20:]

    except websockets.ConnectionClosed:
        print(f"Connection closed: {websocket.remote_address}", flush=True)
    except Exception as e:
        print(f"Exception: {e}", flush=True)
    finally:
        websocket_users.discard(websocket)
        print(f"Connection ended: {websocket.remote_address}", flush=True)


async def main():
    """Main async function"""
    # Setup SSL if needed
    ssl_context = None
    if args.certfile and len(args.certfile) > 0:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(args.certfile, keyfile=args.keyfile)
    
    print(f"Starting WebSocket server on ws://{args.host}:{args.port}/", flush=True)
    print("Models will be loaded on first connection...", flush=True)
    
    # Create server
    server = await websockets.serve(
        ws_serve,
        args.host,
        args.port,
        ssl=ssl_context,
        ping_interval=None,
    )
    
    print(f"WebSocket server started on ws://{args.host}:{args.port}/", flush=True)
    print("Press Ctrl+C to stop", flush=True)
    
    # Run forever
    await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
