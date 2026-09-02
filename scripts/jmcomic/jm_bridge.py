# -*- coding: utf-8 -*-
"""
JMComic CLI Bridge for Koodo Reader
Provides JSON IPC interface for search, rank, detail, and download with CBZ packaging.
"""

import os
import sys
import json
import shutil
import zipfile
import argparse
from typing import List, Optional, Dict, Any

# Ensure standard output and error streams use UTF-8 encoding on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Ensure local JMComic-Crawler-Python package can be imported
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
LOCAL_JMCOMIC_SRC = os.path.join(PROJECT_ROOT, "JMComic-Crawler-Python", "src")
if os.path.exists(LOCAL_JMCOMIC_SRC) and LOCAL_JMCOMIC_SRC not in sys.path:
    sys.path.insert(0, LOCAL_JMCOMIC_SRC)

try:
    import jmcomic
    from jmcomic import (
        JmModuleConfig,
        JmOption,
        JmcomicClient,
        JmcomicText,
        JmAlbumDetail,
        JmPhotoDetail,
        download_album,
        download_photo,
        new_downloader,
    )
    HAS_JMCOMIC = True
except ImportError as e:
    HAS_JMCOMIC = False
    IMPORT_ERROR = str(e)


def emit_json(data: dict):
    """Output JSON string to stdout and flush immediately."""
    print(json.dumps(data, ensure_ascii=False), flush=True)


def emit_progress(percent: float, photo_title: str, current_page: int, total_pages: int, photo_index: int, total_photos: int, msg: str = ""):
    """Emit a structured progress line for Electron main process to capture."""
    payload = {
        "event": "progress",
        "percent": round(percent, 2),
        "photo_title": photo_title,
        "current_page": current_page,
        "total_pages": total_pages,
        "photo_index": photo_index,
        "total_photos": total_photos,
        "msg": msg
    }
    print("PROGRESS:" + json.dumps(payload, ensure_ascii=False), flush=True)


def get_safe_cover_url(album_id: str, size: str = "") -> str:
    """Generate high-availability image CDN cover URL for an album ID."""
    try:
        if HAS_JMCOMIC:
            return JmcomicText.get_album_cover_url(album_id, size=size)
    except Exception:
        pass
    size_str = size if size else ""
    return f"https://cdn-msp3.jmapiproxy2.cc/media/albums/{album_id}{size_str}.jpg"


def create_custom_option(proxy: Optional[str] = None, domain: Optional[str] = None, threads: int = 5, output_dir: Optional[str] = None) -> JmOption:
    """Create a configured JmOption instance with proxy and domain rules."""
    option = JmModuleConfig.option_class().default()

    # Configure proxy
    if proxy and proxy.strip() and proxy != "direct":
        option.client.postman.meta_data.setdefault('proxies', {})
        option.client.postman.meta_data['proxies'] = {
            'http': proxy.strip(),
            'https': proxy.strip()
        }

    # Configure custom domain if specified
    if domain and domain.strip():
        d = domain.strip()
        # If user passed html domain, configure html client domain without breaking API client domain
        if d.endswith('.vip') or d.endswith('.org') or d.endswith('.me') or d.endswith('.club'):
            option.client.domain = {
                'html': [d],
                'api': getattr(JmModuleConfig, 'DOMAIN_API_LIST', ['www.cdnhjk.net', 'www.cdngwc.cc', 'www.cdngwc.net', 'www.cdngwc.club'])
            }
        else:
            option.client.domain = [d]

    # Configure concurrency and output dir
    if threads > 0:
        option.download.threading.image = threads
        option.download.threading.photo = min(threads, 3)

    if output_dir:
        option.dir_rule.base_dir = output_dir

    return option


def cmd_check_env(args):
    """Check Python environment and jmcomic module availability."""
    if not HAS_JMCOMIC:
        emit_json({
            "code": 1,
            "msg": f"jmcomic module not available: {IMPORT_ERROR}",
            "data": {
                "python_version": sys.version,
                "python_path": sys.executable,
                "has_jmcomic": False,
                "import_error": IMPORT_ERROR
            }
        })
        return

    emit_json({
        "code": 0,
        "msg": "ok",
        "data": {
            "python_version": sys.version,
            "python_path": sys.executable,
            "jmcomic_version": getattr(jmcomic, "__version__", "unknown"),
            "has_jmcomic": True
        }
    })


def cmd_install_deps(args):
    """Run pip install to ensure jmcomic and dependencies are installed."""
    import subprocess
    req_file = os.path.join(os.path.dirname(__file__), "requirements.txt")
    target_dir = os.path.join(PROJECT_ROOT, "JMComic-Crawler-Python")

    output_logs = []
    success = False
    last_error = ""

    packages = ["jmcomic", "curl_cffi", "commonX", "PyYAML", "Pillow", "pycryptodome", "rich"]

    pip_cmds = [
        # 1. Try Tsinghua mirror first for fast domestic download
        [sys.executable, "-m", "pip", "install", "--upgrade", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--trusted-host", "pypi.tuna.tsinghua.edu.cn", *packages],
        # 2. Try Aliyun mirror
        [sys.executable, "-m", "pip", "install", "--upgrade", "-i", "https://mirrors.aliyun.com/pypi/simple/", "--trusted-host", "mirrors.aliyun.com", *packages],
        # 3. Try official PyPI
        [sys.executable, "-m", "pip", "install", "--upgrade", *packages],
        # 4. Try requirements.txt if present
        [sys.executable, "-m", "pip", "install", "-r", req_file] if os.path.exists(req_file) else None,
        # 5. Try local package directory if present
        [sys.executable, "-m", "pip", "install", "-e", target_dir] if os.path.exists(target_dir) else None,
    ]

    for cmd in pip_cmds:
        if not cmd:
            continue
        cmd_str = " ".join(cmd)
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
            output_logs.append(f"Command succeeded ({cmd_str}):\n{proc.stdout}")
            success = True
            break
        except Exception as e:
            err_text = getattr(e, 'stderr', str(e)) or getattr(e, 'stdout', '') or str(e)
            last_error = err_text
            output_logs.append(f"Command attempt failed ({cmd_str}):\n{err_text}")

    if success:
        emit_json({
            "code": 0,
            "msg": "Successfully installed JMComic dependencies",
            "data": "\n".join(output_logs)
        })
    else:
        emit_json({
            "code": 1,
            "msg": f"Failed to install dependencies: {last_error}",
            "data": "\n".join(output_logs)
        })


def cmd_get_domains(args):
    """Get available JM domains."""
    if not HAS_JMCOMIC:
        emit_json({"code": 1, "msg": "jmcomic not installed"})
        return
    domains = JmModuleConfig.DOMAIN_ALL_LIST if hasattr(JmModuleConfig, 'DOMAIN_ALL_LIST') else [
        "18comic.vip",
        "18comic.org",
        "jmcomic1.me",
        "jmcomic.me",
        "jm-comic.org",
        "jm-comic.club",
        "jm-comic2.club",
        "jm-comic3.club",
    ]
    emit_json({"code": 0, "data": domains})


def cmd_search(args):
    """Search comics by query keyword, category, order, and page."""
    if not HAS_JMCOMIC:
        emit_json({"code": 1, "msg": "jmcomic not installed"})
        return

    try:
        option = create_custom_option(args.proxy, args.domain)
        client = option.new_jm_client()

        query = args.query.strip() if args.query else ""
        page = int(args.page or 1)
        order_by = args.order or "mr"  # mr: latest, mv: most views, mp: most pictures, tf: most likes
        main_tag = 0
        time = args.time or "a"  # a: all time, t: today, w: week, m: month
        category = args.category or "0"

        # If query is purely numeric, it could be a direct JM album ID
        if query.isdigit() and len(query) >= 4:
            try:
                album = client.get_album_detail(query)
                results = [{
                    "id": str(album.id),
                    "title": album.title,
                    "author": album.author,
                    "tags": album.tags if hasattr(album, 'tags') else [],
                    "cover": getattr(album, 'cover_url', None) or get_safe_cover_url(album.id, size="_3x4"),
                    "page_count": getattr(album, 'page_count', 0),
                    "pub_date": getattr(album, 'pub_date', "")
                }]
                emit_json({
                    "code": 0,
                    "data": {
                        "page": 1,
                        "total_pages": 1,
                        "total_count": 1,
                        "results": results
                    }
                })
                return
            except Exception:
                pass

        # Perform keyword search
        search_page = client.search(
            search_query=query,
            page=page,
            main_tag=main_tag,
            order_by=order_by,
            time=time,
            category=category,
            sub_category=None
        )

        results = []
        for aid, ainfo in search_page.content:
            title = ainfo.get('name') or ainfo.get('title') or f"JM{aid}"
            tags = ainfo.get('tags') or []
            cover = ainfo.get('cover') or get_safe_cover_url(aid, size="_3x4")
            results.append({
                "id": str(aid),
                "title": title,
                "author": ainfo.get('author') or (tags[0] if tags else "未知作者"),
                "tags": tags,
                "cover": cover,
                "page_count": ainfo.get('page_count', 0),
                "pub_date": ainfo.get('pub_date', "")
            })

        total = search_page.total if hasattr(search_page, 'total') else len(results)
        page_count = search_page.page_count if hasattr(search_page, 'page_count') else 1
        if callable(page_count):
            page_count = page_count()

        emit_json({
            "code": 0,
            "data": {
                "page": page,
                "total_pages": max(1, page_count),
                "total_count": total,
                "results": results
            }
        })
    except Exception as e:
        emit_json({"code": 1, "msg": f"Search failed: {str(e)}"})


def cmd_rank(args):
    """Retrieve ranked comics (day/week/month/all)."""
    if not HAS_JMCOMIC:
        emit_json({"code": 1, "msg": "jmcomic not installed"})
        return

    try:
        option = create_custom_option(args.proxy, args.domain)
        client = option.new_jm_client()

        page = int(args.page or 1)
        time_filter = args.time or "m"  # t: today, w: week, m: month, a: all
        order_by = args.order or "mv"  # mv: most views, tf: most likes
        category = args.category or "0"

        # Use categories_filter for ranking
        search_page = client.categories_filter(
            page=page,
            time=time_filter,
            category=category,
            order_by=order_by,
            sub_category=None
        )

        results = []
        for aid, ainfo in search_page.content:
            title = ainfo.get('name') or ainfo.get('title') or f"JM{aid}"
            tags = ainfo.get('tags') or []
            cover = ainfo.get('cover') or get_safe_cover_url(aid, size="_3x4")
            results.append({
                "id": str(aid),
                "title": title,
                "author": ainfo.get('author') or (tags[0] if tags else "未知作者"),
                "tags": tags,
                "cover": cover,
                "page_count": ainfo.get('page_count', 0),
                "pub_date": ainfo.get('pub_date', "")
            })

        total = search_page.total if hasattr(search_page, 'total') else len(results)
        page_count = search_page.page_count if hasattr(search_page, 'page_count') else 1
        if callable(page_count):
            page_count = page_count()

        emit_json({
            "code": 0,
            "data": {
                "page": page,
                "total_pages": max(1, page_count),
                "total_count": total,
                "results": results
            }
        })
    except Exception as e:
        emit_json({"code": 1, "msg": f"Rank query failed: {str(e)}"})


def cmd_detail(args):
    """Get album metadata and chapter list."""
    if not HAS_JMCOMIC:
        emit_json({"code": 1, "msg": "jmcomic not installed"})
        return

    try:
        option = create_custom_option(args.proxy, args.domain)
        client = option.new_jm_client()
        album_id = str(args.album_id).strip()

        album = client.get_album_detail(album_id)

        chapters = []
        if hasattr(album, 'episode_list'):
            for idx, ep in enumerate(album.episode_list):
                pid = str(ep[0])
                pindex = int(ep[1]) if len(ep) > 1 else idx + 1
                ptitle = str(ep[2]) if len(ep) > 2 else f"第 {pindex} 话"
                chapters.append({
                    "id": pid,
                    "index": pindex,
                    "title": ptitle,
                })
        else:
            chapters.append({
                "id": album.id,
                "index": 1,
                "title": album.title
            })

        cover_url = getattr(album, 'cover_url', None) or get_safe_cover_url(album.id)

        data = {
            "id": str(album.id),
            "title": album.title,
            "author": album.author,
            "authors": getattr(album, 'authors', [album.author]),
            "tags": getattr(album, 'tags', []),
            "description": getattr(album, 'description', '') or "",
            "pub_date": getattr(album, 'pub_date', '') or "",
            "update_date": getattr(album, 'update_date', '') or "",
            "page_count": getattr(album, 'page_count', len(chapters)),
            "cover": cover_url,
            "chapters": chapters
        }

        emit_json({"code": 0, "data": data})
    except Exception as e:
        emit_json({"code": 1, "msg": f"Failed to get album detail: {str(e)}"})


def sanitize_filename(name: str) -> str:
    """Remove illegal characters from filename."""
    for ch in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        name = name.replace(ch, '_')
    return name.strip()


def package_cbz(image_dir: str, cbz_output_path: str):
    """Package a folder of images into a standard .cbz zip archive."""
    os.makedirs(os.path.dirname(os.path.abspath(cbz_output_path)), exist_ok=True)
    with zipfile.ZipFile(cbz_output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(image_dir):
            files.sort()
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, image_dir)
                    zf.write(file_path, arcname)


def cmd_download(args):
    """Download an album or specific chapters, with live progress and CBZ conversion."""
    if not HAS_JMCOMIC:
        emit_json({"code": 1, "msg": "jmcomic not installed"})
        return

    album_id = str(args.album_id).strip()
    selected_photo_ids = [pid.strip() for pid in args.photo_ids.split(",") if pid.strip()] if args.photo_ids else []
    output_dir = os.path.abspath(args.output_dir or os.path.join(PROJECT_ROOT, "downloads"))
    combine = args.combine.lower() in ("true", "1") if hasattr(args, 'combine') and args.combine else True
    threads = int(args.threads or 5)

    temp_download_dir = os.path.join(output_dir, "temp", f"jm_{album_id}")
    os.makedirs(temp_download_dir, exist_ok=True)

    try:
        option = create_custom_option(args.proxy, args.domain, threads=threads, output_dir=temp_download_dir)
        client = option.new_jm_client()

        emit_progress(1.0, "正在获取漫画信息...", 0, 0, 0, 0, "正在解析元数据")
        album = client.get_album_detail(album_id)

        title = sanitize_filename(album.title)
        author = sanitize_filename(album.author)
        cover_url = getattr(album, 'cover_url', None) or get_safe_cover_url(album_id)

        episodes_to_download = []
        if hasattr(album, 'episode_list'):
            for ep in album.episode_list:
                pid, pindex, ptitle = str(ep[0]), int(ep[1]), str(ep[2])
                if not selected_photo_ids or pid in selected_photo_ids:
                    episodes_to_download.append((pid, pindex, ptitle))
        else:
            episodes_to_download.append((album.id, 1, album.title))

        total_photos = len(episodes_to_download)
        if total_photos == 0:
            emit_json({"code": 1, "msg": "No chapters selected or found to download."})
            return

        created_files = []

        with new_downloader(option) as dler:
            for current_idx, (pid, pindex, ptitle) in enumerate(episodes_to_download, 1):
                photo_title_sanitized = sanitize_filename(ptitle)
                emit_progress(
                    percent=((current_idx - 1) / total_photos) * 90.0 + 2.0,
                    photo_title=ptitle,
                    current_page=0,
                    total_pages=0,
                    photo_index=current_idx,
                    total_photos=total_photos,
                    msg=f"正在下载第 {current_idx}/{total_photos} 话: {ptitle}"
                )

                photo_detail = dler.download_photo(pid)
                dler.raise_if_has_exception()

        emit_progress(92.0, "下载完成，正在打包 CBZ...", 0, 0, total_photos, total_photos, "正在打包 CBZ 漫画文件")

        if combine or total_photos == 1:
            cbz_filename = f"[{author}] {title}.cbz"
            cbz_path = os.path.join(output_dir, cbz_filename)
            package_cbz(temp_download_dir, cbz_path)
            created_files.append({
                "path": cbz_path,
                "name": cbz_filename,
                "title": album.title,
                "author": album.author,
                "cover_url": cover_url,
                "size": os.path.getsize(cbz_path)
            })
        else:
            for current_idx, (pid, pindex, ptitle) in enumerate(episodes_to_download, 1):
                photo_title_sanitized = sanitize_filename(ptitle)
                chapter_dir = os.path.join(temp_download_dir, str(pindex))
                if not os.path.exists(chapter_dir):
                    chapter_dir = temp_download_dir
                cbz_filename = f"[{author}] {title} - 第{pindex}话 {photo_title_sanitized}.cbz"
                cbz_path = os.path.join(output_dir, cbz_filename)
                package_cbz(chapter_dir, cbz_path)
                created_files.append({
                    "path": cbz_path,
                    "name": cbz_filename,
                    "title": f"{album.title} ({ptitle})",
                    "author": album.author,
                    "cover_url": cover_url,
                    "size": os.path.getsize(cbz_path)
                })

        try:
            shutil.rmtree(temp_download_dir, ignore_errors=True)
        except Exception:
            pass

        emit_progress(100.0, "完成打包", 0, 0, total_photos, total_photos, "下载与打包已完成")

        emit_json({
            "code": 0,
            "event": "finish",
            "album_id": album_id,
            "title": album.title,
            "author": album.author,
            "cover_url": cover_url,
            "files": created_files
        })

    except Exception as e:
        emit_json({"code": 1, "msg": f"Download failed: {str(e)}"})


def main():
    parser = argparse.ArgumentParser(description="JMComic CLI Bridge for Koodo Reader")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    subparsers.add_parser("check_env", help="Check python and jmcomic environment")
    subparsers.add_parser("install_deps", help="Install jmcomic dependencies")
    subparsers.add_parser("get_domains", help="Get list of available JM domains")

    search_p = subparsers.add_parser("search", help="Search comics")
    search_p.add_argument("--query", "-q", default="", help="Search keywords or album id")
    search_p.add_argument("--page", "-p", default=1, type=int, help="Page number")
    search_p.add_argument("--order", "-o", default="mr", help="Order by (mr: latest, mv: views, mp: pictures, tf: likes)")
    search_p.add_argument("--time", "-t", default="a", help="Time range (a: all, t: today, w: week, m: month)")
    search_p.add_argument("--category", "-c", default="0", help="Category filter")
    search_p.add_argument("--proxy", default=None, help="HTTP/SOCKS5 proxy url")
    search_p.add_argument("--domain", default=None, help="JM comic domain")

    rank_p = subparsers.add_parser("rank", help="Get ranking comics")
    rank_p.add_argument("--page", "-p", default=1, type=int, help="Page number")
    rank_p.add_argument("--time", "-t", default="m", help="Time range (t: today, w: week, m: month, a: all)")
    rank_p.add_argument("--order", "-o", default="mv", help="Order by (mv: views, tf: likes)")
    rank_p.add_argument("--category", "-c", default="0", help="Category filter")
    rank_p.add_argument("--proxy", default=None, help="HTTP/SOCKS5 proxy url")
    rank_p.add_argument("--domain", default=None, help="JM comic domain")

    detail_p = subparsers.add_parser("detail", help="Get comic album detail")
    detail_p.add_argument("--album_id", "-id", required=True, help="Album ID")
    detail_p.add_argument("--proxy", default=None, help="HTTP/SOCKS5 proxy url")
    detail_p.add_argument("--domain", default=None, help="JM comic domain")

    dl_p = subparsers.add_parser("download", help="Download album/photo")
    dl_p.add_argument("--album_id", "-id", required=True, help="Album ID")
    dl_p.add_argument("--photo_ids", default=None, help="Comma separated photo IDs to download")
    dl_p.add_argument("--output_dir", "-o", default=None, help="Directory to save CBZ files")
    dl_p.add_argument("--combine", default="true", help="Combine chapters into single CBZ (true/false)")
    dl_p.add_argument("--threads", default=5, type=int, help="Download threads")
    dl_p.add_argument("--proxy", default=None, help="HTTP/SOCKS5 proxy url")
    dl_p.add_argument("--domain", default=None, help="JM comic domain")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "check_env": cmd_check_env,
        "install_deps": cmd_install_deps,
        "get_domains": cmd_get_domains,
        "search": cmd_search,
        "rank": cmd_rank,
        "detail": cmd_detail,
        "download": cmd_download,
    }

    func = dispatch.get(args.command)
    if func:
        func(args)
    else:
        emit_json({"code": 1, "msg": f"Unknown command: {args.command}"})


if __name__ == "__main__":
    main()

