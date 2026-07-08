# Auto-Annotator backend — full agent swarm, CPU wheels by default.
#
# CPU-only works out of the box (slow synthesis, fine for judging).
# NVIDIA GPU: rebuild with --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu126
#             and run the container with --gpus all.
# AMD ROCm:   --build-arg TORCH_INDEX=https://download.pytorch.org/whl/rocm6.2
#             (or skip Docker on the MI300X and use deploy_mi300x.sh).
FROM python:3.12-slim

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

# libgl1/libglib2.0-0 for opencv-python (a transitive ultralytics
# dependency — first-party code never imports cv2).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r requirements-ml.txt --extra-index-url ${TORCH_INDEX}

COPY app ./app
COPY smoke_test.py reset_demo.py ./

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
