"""AMD/WSL DirectML speech models. Explicit GPU tensors; no neural CPU fallback."""
from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
import re
import os
import warnings
import math
import threading
from types import SimpleNamespace
import time
from types import MethodType
import numpy as np
import torch
import torch_directml
from torch.utils._python_dispatch import TorchDispatchMode
from inference_control import InferenceInterrupted, check_inference

class GpuInferenceError(RuntimeError): pass

class GpuKernelMode(TorchDispatchMode):
    def __init__(self, job=None):
        super().__init__()
        self.job = job

    def __torch_dispatch__(self, operation, types, args=(), kwargs=None):
        check_inference(self.job)
        kwargs = kwargs or {}
        name = operation._schema.name
        # DirectML 0.2.5 zero-width padding corrupts int64 output tokens to zero.
        # A GPU clone is the exact no-padding operation, without a host fallback.
        if name == "aten::constant_pad_nd" and args[0].device.type == "privateuseone" and not any(args[1]):
            return args[0].clone()
        if name in ("aten::upsample_nearest1d", "aten::upsample_linear1d"):
            x, size = args[0], args[1]
            if x.device.type == "privateuseone":
                target = size[0]
                coordinates = torch.arange(target, device=x.device, dtype=torch.float32)
                if name == "aten::upsample_nearest1d":
                    indices = torch.floor(coordinates * (x.shape[-1] / target)).long().clamp(max=x.shape[-1] - 1)
                    result = x.index_select(-1, indices)
                else:
                    align = args[2]
                    if align and target > 1:
                        coordinates = coordinates * ((x.shape[-1] - 1) / (target - 1))
                    elif not align:
                        coordinates = ((coordinates + 0.5) * (x.shape[-1] / target) - 0.5).clamp(min=0)
                    left = coordinates.floor().long().clamp(max=x.shape[-1] - 1)
                    right = (left + 1).clamp(max=x.shape[-1] - 1)
                    mix = (coordinates - left).reshape(1, 1, -1)
                    result = x.index_select(-1, left) * (1 - mix) + x.index_select(-1, right) * mix
                if "out" in kwargs:
                    kwargs["out"].copy_(result)
                    return kwargs["out"]
                return result
        if name == "aten::reflection_pad1d" and args[0].device.type == "privateuseone":
            x, padding = args[0], args[1]
            width = x.shape[-1]
            coordinates = torch.arange(-padding[0], width + padding[1], device=x.device, dtype=torch.float32)
            folded = coordinates.remainder(2 * (width - 1))
            indices = torch.where(folded < width, folded, 2 * (width - 1) - folded).long()
            return x.index_select(-1, indices)
        return operation(*args, **kwargs)


class Device:
    def __init__(self):
        names = [torch_directml.device_name(i).rstrip("\0") for i in range(torch_directml.device_count())]
        indices = [i for i, name in enumerate(names) if "amd" in name.lower() or "radeon" in name.lower()]
        if not indices:
            raise GpuInferenceError("No AMD DirectML device")
        self.failed = False
        self.index = indices[0]
        self.name = names[self.index]
        self.tensor_device = torch_directml.device(self.index)
        # A declared host capacity and a user ceiling are distinct. Neither reserves memory.
        physical_mib = int(os.environ["VEYRA_SPEECH_PHYSICAL_VRAM_MIB"])
        budget_mib = int(os.environ["VEYRA_SPEECH_BUDGET_MIB"])
        if not 4096 <= physical_mib <= 131072 or not 4096 <= budget_mib <= min(20480, physical_mib) or budget_mib % 512:
            raise GpuInferenceError("Invalid GPU memory configuration")
        self.info = {"name": self.name, "backend": "torch-directml", "tensorDevice": str(self.tensor_device),
                     "qualified": False, "maxVramBytes": budget_mib * 1024**2,
                     "physicalVramBytes": physical_mib * 1024**2, "reserveBytes": 1024**3, "peakPoolUpperBoundBytes": 0}
        if self.tensor_device.type == "cpu":
            raise GpuInferenceError("CPU speech is disabled")

    def memory(self):
        # The native API returns occupancy in decimal-MB tiles. Counting each tile
        # as a full MiB conservatively includes unused allocator capacity as well.
        tiles = torch_directml.gpu_memory(self.index, 1)
        if not tiles or any(not math.isfinite(x) or not 0 <= x <= 1.001 for x in tiles):
            raise GpuInferenceError("GPU memory accounting is unavailable")
        upper = len(tiles) * 1024**2
        self.info["peakPoolUpperBoundBytes"] = max(self.info["peakPoolUpperBoundBytes"], upper)
        # DirectML exposes allocation accounting, not a hard allocator cap. Refuse
        # results beyond the selected pool limit, leaving one GiB for driver overhead.
        if upper > self.info["maxVramBytes"] - self.info["reserveBytes"]:
            self.info["qualified"] = False
            raise GpuInferenceError("GPU allocation pool exceeds the speech budget")
        return {"poolUpperBoundBytes": upper, "occupiedBytes": math.ceil(sum(tiles) * 1_000_000)}

    @contextmanager
    def inference(self, job=None):
        check_inference(job)
        if self.failed:
            raise GpuInferenceError("GPU worker is quarantined after an inference fault")
        memory_checked = False
        try:
            try:
                with warnings.catch_warnings(record=True) as captured, torch.no_grad(), GpuKernelMode(job):
                    warnings.simplefilter("always")
                    warnings.filterwarnings("error", message=r".*(?:fall back|fallback).*CPU.*", category=UserWarning)
                    check_inference(job)
                    yield
                check_inference(job)
                fallback = [str(item.message) for item in captured if "cpu" in str(item.message).lower() and "fall" in str(item.message).lower()]
                if fallback:
                    raise GpuInferenceError("Unsupported GPU operator")
                self.memory()
                memory_checked = True
                check_inference(job)
            except InferenceInterrupted:
                # Interrupted jobs may already have allocated tensors. Keep the
                # budget guard current before allowing a replacement request.
                if not memory_checked:
                    self.memory()
                raise
        except (RuntimeError, UserWarning):
            # Native fallback warnings may be emitted only once. Quarantine the
            # model after the first fault so later requests cannot silently fall back.
            self.failed = True
            self.info.update({"qualified": False, "faulted": True})
            raise

    def require_model(self, model):
        if not all(parameter.device.type == self.tensor_device.type for parameter in model.parameters()):
            raise GpuInferenceError("Model weights are not entirely on GPU")
        self.memory()


def lstm_batch_one(module, x, hidden=None):
    # Explicit GPU gate arithmetic avoids the crashing native DirectML LSTM entry point.
    # Input projections are batched once; only the recurrent state depends on the prior step.
    if not isinstance(x, torch.Tensor) or x.ndim != 3 or module.num_layers != 1 or not module.batch_first:
        raise GpuInferenceError("Unsupported GPU LSTM profile")
    if x.shape[0] != 1:
        raise GpuInferenceError("GPU LSTM accepts one utterance")
    directions = 2 if module.bidirectional else 1
    outputs, final_h, final_c = [], [], []
    for direction in range(directions):
        suffix = "_reverse" if direction else ""
        wi = getattr(module, "weight_ih_l0" + suffix)
        wh = getattr(module, "weight_hh_l0" + suffix)
        bi = getattr(module, "bias_ih_l0" + suffix) if module.bias else None
        bh = getattr(module, "bias_hh_l0" + suffix) if module.bias else None
        projected = torch.nn.functional.linear(x, wi, bi)
        if bh is not None:
            projected = projected + bh
        h = x.new_zeros((1, module.hidden_size)) if hidden is None else hidden[0][direction]
        c = x.new_zeros((1, module.hidden_size)) if hidden is None else hidden[1][direction]
        values = [None] * x.shape[1]
        sequence = range(x.shape[1] - 1, -1, -1) if direction else range(x.shape[1])
        for position in sequence:
            gates = projected[:, position, :] + torch.nn.functional.linear(h, wh)
            input_gate, forget_gate, candidate, output_gate = gates.chunk(4, dim=-1)
            c = torch.sigmoid(forget_gate) * c + torch.sigmoid(input_gate) * torch.tanh(candidate)
            h = torch.sigmoid(output_gate) * torch.tanh(c)
            values[position] = h
        outputs.append(torch.stack(values, dim=1))
        final_h.append(h); final_c.append(c)
    return torch.cat(outputs, dim=-1), (torch.stack(final_h, dim=0), torch.stack(final_c, dim=0))


def convolution_kernel_for_transpose(weight, groups):
    channels, output_per_group, kernel_size = weight.shape
    return weight.reshape(groups, channels // groups, output_per_group, kernel_size).transpose(1, 2).reshape(output_per_group * groups, channels // groups, kernel_size).flip(-1).contiguous()


def expanded_transpose_convolution(x, kernel, bias=None, stride=1, padding=0, output_padding=0, groups=1, dilation=1):
    # Keep the input rank unchanged: DirectML convolution cannot safely consume a
    # three-dimensional view backed by a padded four-dimensional GPU allocation.
    expanded = torch.nn.functional.pad(x.unsqueeze(-1), (0, stride - 1)).reshape(x.shape[0], x.shape[1], x.shape[2] * stride)
    length = (x.shape[2] - 1) * stride + 1 + output_padding
    expanded = expanded[..., :length].contiguous()
    return torch.nn.functional.conv1d(expanded, kernel, bias, padding=dilation * (kernel.shape[-1] - 1) - padding, dilation=dilation, groups=groups)


def transpose_convolution_1d_on_gpu(module, x, output_size=None):
    if output_size is not None:
        raise GpuInferenceError("Dynamic transposed-convolution output size is unsupported")
    if not hasattr(module, "_stratus_kernel"):
        module.register_buffer("_stratus_kernel", convolution_kernel_for_transpose(module.weight, module.groups))
    return expanded_transpose_convolution(x, module._stratus_kernel, module.bias, module.stride[0], module.padding[0], module.output_padding[0], module.groups, module.dilation[0])


def stft_transform_on_gpu(module, waveform):
    if module.center:
        pad = module.n_fft // 2
        waveform = torch.nn.functional.pad(waveform, (pad, pad), mode=module.pad_mode)
    x = waveform.unsqueeze(1)
    real = torch.nn.functional.conv1d(x, module.weight_forward_real, stride=module.hop_length)
    imaginary = torch.nn.functional.conv1d(x, module.weight_forward_imag, stride=module.hop_length)
    magnitude = torch.sqrt(real ** 2 + imaginary ** 2 + 1e-14)
    phase = torch.atan2(imaginary, real)
    phase = torch.where((imaginary == 0) & (real < 0), torch.full_like(phase, torch.pi), phase)
    return magnitude, phase


def stft_inverse_on_gpu(module, magnitude, phase, length=None):
    real = magnitude * torch.cos(phase)
    imaginary = magnitude * torch.sin(phase)
    wave = expanded_transpose_convolution(real, module._stratus_real_kernel, stride=module.hop_length) - expanded_transpose_convolution(imaginary, module._stratus_imag_kernel, stride=module.hop_length)
    if module.center:
        pad = module.n_fft // 2
        wave = wave[..., pad:-pad]
    return wave if length is None else wave[..., :length]


def materialize_inference_weights(model):
    for layer in list(model.modules()):
        if hasattr(layer, "weight_g"):
            torch.nn.utils.remove_weight_norm(layer)
        if torch.nn.utils.parametrize.is_parametrized(layer, "weight"):
            torch.nn.utils.parametrize.remove_parametrizations(layer, "weight", leave_parametrized=True)


def adapt_gpu_modules(model):
    for layer in model.modules():
        if isinstance(layer, torch.nn.LSTM):
            layer.forward = MethodType(lstm_batch_one, layer)
        elif isinstance(layer, torch.nn.ConvTranspose1d):
            layer.register_buffer("_stratus_kernel", convolution_kernel_for_transpose(layer.weight, layer.groups))
            layer.forward = MethodType(transpose_convolution_1d_on_gpu, layer)
        elif type(layer).__name__ == "CustomSTFT":
            layer.register_buffer("_stratus_real_kernel", convolution_kernel_for_transpose(layer.weight_backward_real, 1))
            layer.register_buffer("_stratus_imag_kernel", convolution_kernel_for_transpose(layer.weight_backward_imag, 1))
            layer.transform = MethodType(stft_transform_on_gpu, layer)
            layer.inverse = MethodType(stft_inverse_on_gpu, layer)


def duration_batch_one(module, x, style, text_lengths, mask):
    # This worker admits exactly one utterance. A full-length batch of one needs no
    # PackedSequence; DirectML's packed LSTM overload segfaults in torch-directml 0.2.5.
    if x.shape[0] != 1 or int(text_lengths[0].item()) != x.shape[-1]:
        raise GpuInferenceError("Only unpadded single-utterance GPU batches are supported")
    from kokoro.modules import AdaLayerNorm
    expanded_style = style.unsqueeze(-1).expand(1, -1, x.shape[-1])
    x = torch.cat([x, expanded_style], dim=1)
    x = x.masked_fill(mask.unsqueeze(1), 0.0)
    for block in module.lstms:
        if isinstance(block, AdaLayerNorm):
            x = block(x.transpose(-1, -2), style).transpose(-1, -2)
            x = torch.cat([x, expanded_style], dim=1)
            x = x.masked_fill(mask.unsqueeze(1), 0.0)
        else:
            x, _ = block(x.transpose(-1, -2))
            x = x.transpose(-1, -2)
    return x.transpose(-1, -2)


def text_batch_one(module, x, input_lengths, mask):
    if x.shape[0] != 1 or int(input_lengths[0].item()) != x.shape[-1]:
        raise GpuInferenceError("Only unpadded single-utterance GPU batches are supported")
    x = module.embedding(x).transpose(1, 2)
    expanded_mask = mask.unsqueeze(1)
    x = x.masked_fill(expanded_mask, 0.0)
    for convolution in module.cnn:
        x = convolution(x).masked_fill(expanded_mask, 0.0)
    x, _ = module.lstm(x.transpose(1, 2))
    return x.transpose(1, 2).masked_fill(expanded_mask, 0.0)


def alignment_on_gpu(durations):
    # Broadcast cumulative boundaries replace unsupported repeat_interleave/scatter.
    # Counts remain exactly representable in float32; only the allocation size crosses to the host.
    ends = torch.cumsum(durations.float(), dim=0)
    total = int(ends[-1].item())
    if not 1 <= total <= 1200:
        raise GpuInferenceError("Predicted speech duration exceeds the GPU profile")
    starts = ends - durations
    positions = torch.arange(total, device=durations.device, dtype=torch.float32)
    return ((positions.unsqueeze(0) >= starts.unsqueeze(1)) & (positions.unsqueeze(0) < ends.unsqueeze(1))).float()


def kokoro_tokens_on_gpu(module, input_ids, ref_s, speed=1.0):
    if input_ids.shape[0] != 1:
        raise GpuInferenceError("Only one GPU utterance is supported")
    length = input_ids.shape[1]
    input_lengths = torch.full((1,), length, device=input_ids.device, dtype=torch.long)
    mask = torch.zeros((1, length), device=input_ids.device, dtype=torch.bool)
    bert_duration = module.bert(input_ids, attention_mask=(~mask).int())
    encoded = module.bert_encoder(bert_duration).transpose(-1, -2)
    style = ref_s[:, 128:]
    duration_encoded = module.predictor.text_encoder(encoded, style, input_lengths, mask)
    recurrent, _ = module.predictor.lstm(duration_encoded)
    duration = torch.sigmoid(module.predictor.duration_proj(recurrent)).sum(axis=-1) / speed
    predicted = torch.round(duration).clamp(min=1).squeeze(0)
    alignment = alignment_on_gpu(predicted).unsqueeze(0)
    prosody = duration_encoded.transpose(-1, -2) @ alignment
    fundamental, noise = module.predictor.F0Ntrain(prosody, style)
    text = module.text_encoder(input_ids, input_lengths, mask)
    acoustic = text @ alignment
    audio = module.decoder(acoustic, fundamental, noise, ref_s[:, :128]).squeeze()
    return audio, predicted


class KokoroGpu:
    def __init__(self, root: Path, config: dict, device: Device):
        from kokoro import KModel
        from misaki.espeak import EspeakFallback
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        import espeakng_loader
        self.device = device
        tts = config["tts"]
        self.model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(root / tts["directory"] / "config.json"),
                            model=str(root / tts["directory"] / "kokoro-v1_0.pth"), disable_complex=True).eval()
        # Materialize inference weights once before GPU transfer; no normalization hooks on CPU at each sentence.
        materialize_inference_weights(self.model)
        adapt_gpu_modules(self.model)
        self.model.forward_with_tokens = MethodType(kokoro_tokens_on_gpu, self.model)
        self.model.predictor.text_encoder.forward = MethodType(duration_batch_one, self.model.predictor.text_encoder)
        self.model.text_encoder.forward = MethodType(text_batch_one, self.model.text_encoder)
        self.model.to(device.tensor_device)
        device.require_model(self.model)
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        # Kokoro is trained on Misaki symbols, not raw eSpeak IPA. Use its
        # non-neural English normalization (no CPU speech inference or downloads).
        self.phonemizers = {language: EspeakFallback(british=language == "en-gb")
                           for language in ("en-us", "en-gb")}
        self.voices = np.load(str(root / config["voices"]["file"]), allow_pickle=False)

    def synthesize(self, text: str, voice_id: str, language: str, job=None) -> bytes:
        check_inference(job)
        if voice_id not in self.voices or language not in self.phonemizers:
            raise GpuInferenceError("Unknown GPU voice")
        phonemes, _ = self.phonemizers[language](SimpleNamespace(text=text))
        phonemes = (phonemes or "").strip()
        count = len(phonemes)
        if not 1 <= count <= 500:
            raise GpuInferenceError("Phoneme limit")
        with self.device.inference(job):
            style = torch.from_numpy(self.voices[voice_id][count - 1]).reshape(1, -1).to(self.device.tensor_device)
            ids = [0, *[self.model.vocab[char] for char in phonemes if char in self.model.vocab], 0]
            audio, _ = self.model.forward_with_tokens(torch.tensor([ids], dtype=torch.long, device=self.device.tensor_device), style, speed=1.0)
            if audio.device.type != self.device.tensor_device.type:
                raise GpuInferenceError("TTS did not run on GPU")
            if audio.numel() > 24000 * 15:
                raise GpuInferenceError("Speech duration limit")
            output = audio.detach().reshape(-1).cpu().numpy()
        if not np.isfinite(output).all():
            raise GpuInferenceError("Invalid GPU speech")
        return (np.clip(output, -1, 1) * 32767).astype("<i2").tobytes()


class Preset:
    def __init__(self, engine: KokoroGpu, voice_id: str, language: str):
        self.engine, self.voice_id, self.language = engine, voice_id, language
    def chunks(self, text: str):
        yield 24000, 1, 2, self.engine.synthesize(text, self.voice_id, self.language)
    def chunks_for_job(self, text: str, job):
        yield 24000, 1, 2, self.engine.synthesize(text, self.voice_id, self.language, job)


class WhisperGpu:
    def __init__(self, root: Path, config: dict, device: Device):
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
        self.device = device
        directory = str(root / config["stt"]["directory"])
        self.processor = WhisperProcessor.from_pretrained(directory, local_files_only=True)
        self.no_speech_id = self.processor.tokenizer.convert_tokens_to_ids("<|nocaptions|>")
        if self.no_speech_id != 50361:
            raise GpuInferenceError("Unexpected English Whisper special-token vocabulary")
        self.model = WhisperForConditionalGeneration.from_pretrained(directory, local_files_only=True,
            torch_dtype=torch.float32, attn_implementation="eager").eval().to(device.tensor_device)
        device.require_model(self.model)

    def transcribe(self, pcm: bytes, job) -> str:
        check_inference(job)
        self.last_no_speech_probability = None
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        if float(np.sqrt(np.mean(audio * audio))) < 0.002:
            return ""
        features = self.processor(audio, sampling_rate=16000, return_tensors="pt", return_attention_mask=True)
        no_speech = []
        def confidence(_module, _inputs, logits):
            if not no_speech:
                probability = logits[:, 0, :].float().softmax(-1)[0, self.no_speech_id]
                no_speech.append(float(probability.item()))
        # Capture Whisper's no-speech probability at the start token. The pinned
        # Transformers built-in processor passes an invalid input_ids argument.
        hook = self.model.proj_out.register_forward_hook(confidence)
        try:
            with self.device.inference(job):
                output = self.model.generate(input_features=features.input_features.to(self.device.tensor_device),
                    attention_mask=features.attention_mask.to(self.device.tensor_device),
                    max_new_tokens=96, do_sample=False, num_beams=1, return_timestamps=False)
                if output.device.type != self.device.tensor_device.type:
                    raise GpuInferenceError("STT did not run on GPU")
                tokens = output.cpu()
        finally:
            hook.remove()
        self.last_no_speech_probability = no_speech[0] if no_speech else None
        if not no_speech or not math.isfinite(no_speech[0]):
            raise GpuInferenceError("Speech confidence unavailable")
        if no_speech[0] > 0.6:
            return ""
        if job.cancelled.is_set():
            raise GpuInferenceError("Transcription cancelled")
        if time.monotonic() > job.deadline:
            raise GpuInferenceError("Transcription deadline")
        text = self.processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
        if len(text) > 2000:
            raise GpuInferenceError("Transcript limit")
        return text


def load_gpu_models(root: Path, manifest: dict):
    device = Device()
    engine = KokoroGpu(root, manifest["gpu"], device)
    models = {}
    catalog = []
    for preset in manifest["gpu"]["presets"]:
        models[preset["id"]] = Preset(engine, preset["id"], preset["language"])
        catalog.append({**preset, "engine": "kokoro"})
    stt = WhisperGpu(root, manifest["gpu"], device)
    # Do real neural inference before the HTTP socket opens. A device flag or
    # loaded weights alone never make the worker ready for live conversation.
    phrase = "Hello. We can keep talking naturally, using the graphics card."
    started = time.monotonic()
    rate, _, _, raw = next(models[manifest["voice"]].chunks(phrase))
    tts_ms = round((time.monotonic() - started) * 1000)
    values = np.frombuffer(raw, dtype="<i2")
    positions = np.arange(int(len(values) * 16000 / rate)) * rate / 16000
    pcm = np.interp(positions, np.arange(len(values)), values).round().astype("<i2").tobytes()
    started = time.monotonic()
    text = stt.transcribe(pcm, SimpleNamespace(cancelled=threading.Event(), deadline=time.monotonic() + 15))
    normalize = lambda value: re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    if normalize(text) != normalize(phrase):
        raise GpuInferenceError("GPU startup speech recognition did not match the known fixture")
    device.info.update({"qualified": True, "neuralCpuFallback": False,
                       "warmup": {"ttsMs": tts_ms, "sttMs": round((time.monotonic()-started)*1000), "knownPhraseMatched": True}})
    return models, catalog, stt, device.info
