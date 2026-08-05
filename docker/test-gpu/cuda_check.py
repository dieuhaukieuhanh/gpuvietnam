#!/usr/bin/env python3
"""
Minimal CUDA compute smoke test — no PyTorch dependency.

Uses ctypes to load libcuda.so and perform:
  1. cuInit — verify CUDA driver is loaded
  2. cuDeviceGetCount — verify at least 1 GPU
  3. cuDeviceGetName — get GPU name
  4. cuMemGetInfo — get VRAM free/total

Exits 0 on success, non-zero on failure.
Prints CUDA_SMOKE_OK or CUDA_SMOKE_FAIL to stdout.
"""

import ctypes
import ctypes.util
import sys


def find_cuda_lib():
    """Find libcuda.so on the system."""
    paths = [
        ctypes.util.find_library("cuda"),
        "/usr/lib/x86_64-linux-gnu/libcuda.so",
        "/usr/lib/x86_64-linux-gnu/libcuda.so.1",
        "/usr/local/cuda/lib64/libcuda.so",
        "/usr/local/cuda/lib64/stubs/libcuda.so",
    ]
    for p in paths:
        if p:
            try:
                lib = ctypes.CDLL(p)
                return lib, p
            except OSError:
                continue
    return None, ""


# CUDA error codes
CUDA_SUCCESS = 0


def main():
    lib, path = find_cuda_lib()
    if not lib:
        print("CUDA_SMOKE_FAIL: libcuda.so not found")
        sys.exit(1)

    # cuInit(0)
    cuInit = lib.cuInit
    cuInit.argtypes = [ctypes.c_uint]
    cuInit.restype = ctypes.c_int
    err = cuInit(0)
    if err != CUDA_SUCCESS:
        print(f"CUDA_SMOKE_FAIL: cuInit returned {err}")
        sys.exit(2)

    # cuDeviceGetCount
    cuDeviceGetCount = lib.cuDeviceGetCount
    cuDeviceGetCount.argtypes = [ctypes.POINTER(ctypes.c_int)]
    cuDeviceGetCount.restype = ctypes.c_int
    count = ctypes.c_int()
    err = cuDeviceGetCount(ctypes.byref(count))
    if err != CUDA_SUCCESS or count.value < 1:
        print(f"CUDA_SMOKE_FAIL: cuDeviceGetCount={count.value}, err={err}")
        sys.exit(3)

    # cuDeviceGetName for device 0
    cuDeviceGet = lib.cuDeviceGet
    cuDeviceGet.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]
    cuDeviceGet.restype = ctypes.c_int
    device = ctypes.c_int()
    err = cuDeviceGet(ctypes.byref(device), 0)
    if err != CUDA_SUCCESS:
        print(f"CUDA_SMOKE_FAIL: cuDeviceGet(0) returned {err}")
        sys.exit(4)

    cuDeviceGetName = lib.cuDeviceGetName
    cuDeviceGetName.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    cuDeviceGetName.restype = ctypes.c_int
    name_buf = ctypes.create_string_buffer(256)
    err = cuDeviceGetName(name_buf, 256, device)
    if err != CUDA_SUCCESS:
        print(f"CUDA_SMOKE_FAIL: cuDeviceGetName returned {err}")
        sys.exit(5)
    gpu_name = name_buf.value.decode("utf-8", errors="replace")

    # cuMemGetInfo
    cuMemGetInfo = lib.cuMemGetInfo
    cuMemGetInfo.argtypes = [ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
    cuMemGetInfo.restype = ctypes.c_int
    free_mem = ctypes.c_size_t()
    total_mem = ctypes.c_size_t()
    err = cuMemGetInfo(ctypes.byref(free_mem), ctypes.byref(total_mem))
    vram_info = ""
    if err == CUDA_SUCCESS:
        total_gb = total_mem.value / (1024 ** 3)
        free_gb = free_mem.value / (1024 ** 3)
        vram_info = f" VRAM total={total_gb:.1f}GB free={free_gb:.1f}GB"

    print(f"CUDA_SMOKE_OK: device_count={count.value} gpu={gpu_name}{vram_info}")
    sys.exit(0)


if __name__ == "__main__":
    main()
