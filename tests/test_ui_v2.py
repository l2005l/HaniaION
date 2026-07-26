from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def all_text():
    paths = list((ROOT / "haniaion_ui_v2").rglob("*"))
    return "\n".join(p.read_text(encoding="utf-8") for p in paths if p.is_file() and p.suffix in {".py",".html",".js",".css",".webmanifest"})

def test_calculate_is_only_called_not_defined():
    text = all_text()
    assert 'fetch("/api/calculate"' in text
    assert '@router.post("/api/calculate"' not in text
    assert '@router.get("/api/calculate"' not in text

def test_removed_terms_absent():
    text = all_text().lower()
    forbidden = ["developer", "aviation", "mission", "open source"]
    for phrase in forbidden:
        assert phrase not in text

def test_required_features_present():
    text = all_text()
    for phrase in ["Retrieve Latest Data","Data1","Data2","Data3","Data4","tLS","K69","History","Export TXT","Export JSON"]:
        assert phrase in text

def test_pwa_files_exist():
    assert (ROOT / "haniaion_ui_v2/static/manifest.webmanifest").exists()
    assert (ROOT / "haniaion_ui_v2/static/sw.js").exists()
