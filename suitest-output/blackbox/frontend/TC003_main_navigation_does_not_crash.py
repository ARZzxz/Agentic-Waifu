import asyncio
import glob
import json
import os
import re
import shutil
import subprocess
import uuid

from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get("SUITEST_TARGET_BASE_URL", 'http://localhost:3000')
USERNAME = os.environ.get("SUITEST_TEST_USERNAME", "")
PASSWORD = os.environ.get("SUITEST_TEST_PASSWORD", "")
TIMEOUT = 15000
TC_ID = "TC003"

# --- evidence pacing (watchable, step-by-step video) -------------------------
# The lifecycle video is human EVIDENCE, so it must NOT run at machine speed.
# We hold each step on screen (``_STEP_PAUSE_MS``) and slow every Playwright
# action (``_SLOWMO_MS``) so the recording reads step-by-step. Defaults are on;
# set SUITEST_EVIDENCE_RECORDING=false (or the pause to 0) for a fast run.
_EVIDENCE = os.environ.get("SUITEST_EVIDENCE_RECORDING", "true").lower() not in ("0", "false", "no")
_STEP_PAUSE_MS = int(os.environ.get("SUITEST_EVIDENCE_PAUSE_MS", "1200"))
_SLOWMO_MS = int(os.environ.get("SUITEST_EVIDENCE_SLOWMO_MS", "300"))

_HERE = os.path.dirname(os.path.abspath(__file__))
_TMP = os.path.join(_HERE, "tmp")
_VIDEO_DIR = os.path.join(_TMP, "videos", TC_ID)
_RESULT = os.path.join(_HERE, TC_ID + ".result.json")

# --- per-step recorder (feeds the web Steps panel) ---------------------------
STEPS = []
_cur = {"index": 0, "type": "action", "description": ""}
_N = [0]


def _begin(step_type, description):
    _N[0] += 1
    _cur.update(index=_N[0], type=step_type, description=description)


def _trim_leading_blank(src):
    # Playwright starts recording at about:blank (white) and keeps rolling
    # through the app's first-load spinner before content paints. Detect the
    # first real visual change (scene change) and drop everything before it.
    # ffmpeg is optional: if it's absent, detection fails, or there's nothing to
    # trim, the original video is kept untouched.
    # ponytail: re-encode is O(video length); fine for short evidence clips. If
    #           clips ever get long, switch to -c copy with keyframe snapping.
    if shutil.which("ffmpeg") is None:
        return src
    try:
        probe = subprocess.run(
            ["ffmpeg", "-i", src, "-vf", "select='gt(scene,0.02)',showinfo",
             "-an", "-f", "null", "-"],
            capture_output=True, text=True, timeout=30,
        )
        m = re.search(r"pts_time:(\d+\.?\d*)", probe.stderr)
        if not m:
            return src
        start = max(float(m.group(1)) - 0.15, 0.0)
        if start < 0.2:  # nothing meaningful to trim
            return src
        out = src[:-5] + ".trim.webm"
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", "%.3f" % start, "-i", src,
             "-c:v", "libvpx-vp9", "-an", out],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
            os.replace(out, src)  # overwrite same name -> result.json unchanged
    except Exception:
        pass
    return src


async def _shot(page):
    # Per-step screenshot — powers the web "Preview: Step N" (TestSprite parity).
    path = os.path.join(_TMP, TC_ID + "_step" + str(_cur["index"]) + ".png")
    try:
        os.makedirs(_TMP, exist_ok=True)
        await page.screenshot(path=path)
        return path
    except Exception:
        return ""


async def _ok(page):
    shot = await _shot(page)
    # Hold the finished step on screen so the recorded video reads step-by-step
    # instead of flashing past in ~1s. Screenshot is taken BEFORE the hold so it
    # captures the step's end state, not the idle pause.
    if _EVIDENCE and _STEP_PAUSE_MS > 0:
        try:
            await page.wait_for_timeout(_STEP_PAUSE_MS)
        except Exception:
            pass
    STEPS.append(dict(_cur, status="PASSED", screenshot=shot))



def _safe_value(kind, label=""):
    import datetime
    l = (label or "").lower()
    if kind == "email" or "email" in l:
        return "qa+" + uuid.uuid4().hex[:6] + "@example.com"
    if kind == "number":
        return "1"
    if kind == "date":
        return datetime.date.today().isoformat()
    if kind == "textarea":
        return "Automated QA test value"
    return "Test value"

async def _body(page):
    for route in ["/login", "/"]:
        _begin("action", "Open " + route)
        await page.goto(f"{BASE_URL}" + route, wait_until="domcontentloaded")
        await page.wait_for_timeout(600)
        await _ok(page)
        _begin("assertion", route + " renders content and no crash text")
        text = await page.evaluate("() => document.body.innerText.trim()")
        assert len(text) > 0, route + " rendered blank"
        low = text.lower()
        assert "internal server error" not in low and "traceback" not in low, route + " crashed"
        await _ok(page)


async def run_test():
    pw = browser = context = page = None
    status = "PASSED"
    error = ""
    try:
        # One directory represents one execution. Reusing it made videos from
        # old runs accumulate and lexicographic selection could publish stale
        # evidence instead of the current recording.
        shutil.rmtree(_VIDEO_DIR, ignore_errors=True)
        os.makedirs(_VIDEO_DIR, exist_ok=True)
        # Start a Playwright session in asynchronous mode.
        pw = await async_playwright().start()
        # Launch a Chromium browser in headless mode with custom arguments.
        browser = await pw.chromium.launch(
            headless=True,
            # slow_mo delays each action so intra-step motion (typing, clicks,
            # navigation) is visible in the recorded video, not just the gaps.
            slow_mo=_SLOWMO_MS if _EVIDENCE else 0,
            args=["--window-size=1280,720", "--disable-dev-shm-usage", "--ipc=host"],
        )
        # Create a new browser context that records video of the whole run.
        context = await browser.new_context(
            record_video_dir=_VIDEO_DIR, viewport={"width": 1280, "height": 720}
        )
        # Wider default timeout so auto-waiting Playwright APIs inherit it.
        context.set_default_timeout(TIMEOUT)
        page = await context.new_page()
        await _body(page)
        # Hold the final state so the video's last frames aren't clipped when the
        # context closes (Playwright stops recording on context.close()).
        if _EVIDENCE and _STEP_PAUSE_MS > 0:
            try:
                await page.wait_for_timeout(_STEP_PAUSE_MS)
            except Exception:
                pass
    except Exception as exc:  # record the failing step + capture a screenshot
        status = "FAILED"
        error = str(exc)
        _fail_shot = ""
        if page is not None:
            try:
                _fail_shot = os.path.join(_TMP, TC_ID + "_step" + str(_cur["index"]) + ".png")
                await page.screenshot(path=_fail_shot)
            except Exception:
                _fail_shot = ""
        STEPS.append(dict(_cur, status="FAILED", screenshot=_fail_shot))
    finally:
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass
        vids = sorted(glob.glob(os.path.join(_VIDEO_DIR, "*.webm")))
        _video = vids[-1] if vids else None
        if _video:
            _video = _trim_leading_blank(_video)
        with open(_RESULT, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "testId": TC_ID,
                    "status": status,
                    "error": error,
                    "steps": STEPS,
                    "video": _video,
                    # Per-step screenshots already include the final state.
                    # A second "final" PNG doubled the last frame for no UI value.
                    "screenshot": None,
                },
                fh,
            )
    if status != "PASSED":
        raise AssertionError(error or "test failed")


if __name__ == "__main__":
    asyncio.run(run_test())
    print("PASS " + TC_ID)
