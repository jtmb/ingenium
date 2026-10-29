"""Cooperative request checks shared by the worker and GPU adapter; no model imports."""
from __future__ import annotations
import time


class InferenceInterrupted(Exception):
    """Expected request interruption, separate from a device/operator failure."""
    def __init__(self, code: str):
        self.code = code
        self.status = 409 if code == "CANCELLED" else 504
        super().__init__(code)


def check_inference(job) -> None:
    if job is None:
        return
    if job.cancelled.is_set():
        raise InferenceInterrupted("CANCELLED")
    if time.monotonic() > job.deadline:
        raise InferenceInterrupted("DEADLINE")
