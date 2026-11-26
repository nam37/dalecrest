"""Build the public changelog for a candidate Dalecrest release."""

import argparse
import json
import re
import subprocess
from datetime import date
from html import escape
from pathlib import Path


BACKFILLED_THROUGH = "5d0632fd0579d8ceec8fa0b5f1a04ed6f95972e2"
COMMIT_URL = "https://github.com/nam37/dalecrest/commit/"
INSERT = "<!-- generated-development-notes -->"
VISITOR_FILES = (
    "public/", "engine/", "server.mjs", "sim.mjs", "daily.mjs", "robin-journal.mjs",
    "record-pages.mjs", "request-archive.mjs", "village-history.mjs",
)
MAINTENANCE = re.compile(r"^(?:build|chore|ci|deploy|docs|refactor|test)(?:\([^)]*\))?!?:", re.I)
PREFIX = re.compile(r"^(?:feat|fix|perf|style)(?:\([^)]*\))?!?:\s*", re.I)


def release_changes(repo, base, revision):
    output = subprocess.check_output([
        "git", "--git-dir", str(repo), "log", "-z", "--no-merges", "--full-history",
        "--format=%H%x00%s", f"{base}..{revision}", "--", *VISITOR_FILES,
    ], encoding="utf-8", errors="replace")
    fields = output.rstrip("\0").split("\0") if output else []
    notes = []
    for sha, subject in zip(fields[::2], fields[1::2]):
        if MAINTENANCE.match(subject) or "[skip changelog]" in subject.lower():
            continue
        title = PREFIX.sub("", subject).strip()
        if title:
            notes.append({"sha": sha, "title": title})
    return notes


def with_release(history, day, changes):
    seen = {note["sha"] for notes in history.values() for note in notes}
    new = [note for note in changes if note["sha"] not in seen]
    if new:
        return {**history, day: new + history.get(day, [])}
    return history


def note_link(note):
    return f'<a href="{COMMIT_URL}{escape(note["sha"])}">{escape(note["title"])}</a>'


def note_list(notes):
    items = "".join(f"\n          <li>{note_link(note)}</li>" for note in notes)
    return f'<ul class="development-changes">{items}\n        </ul>' if items else ""


def render_page(template, history):
    if template.count(INSERT) != 1:
        raise ValueError("The development page needs one release-note insertion point.")
    articles = []
    for day, notes in sorted(history.items(), reverse=True):
        when = date.fromisoformat(day)
        slot = f"<!-- development-notes:{day} -->"
        if slot in template:
            template = template.replace(slot, note_list(notes), 1)
            continue
        articles.append(f'''
    <article class="development-entry" id="{day}">
      <time datetime="{day}">{when.day} {when:%B %Y}</time>
      <div>
        <h2>{note_link(notes[0])}</h2>{note_list(notes[1:])}
      </div>
    </article>
''')
    return template.replace(INSERT, "\n".join(articles).rstrip(), 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--previous", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    parser.add_argument("--history", type=Path, required=True)
    parser.add_argument("--output-history", type=Path, required=True)
    parser.add_argument("--page", type=Path, required=True)
    args = parser.parse_args()

    if args.history.is_file():
        history = json.loads(args.history.read_text(encoding="utf-8"))
        base = args.previous
    else:
        history = {}
        base = BACKFILLED_THROUGH
    changes = release_changes(args.repo, base, args.revision)
    updated = with_release(history, args.date.isoformat(), changes)
    args.page.write_text(render_page(args.page.read_text(encoding="utf-8"), updated), encoding="utf-8")
    args.output_history.write_text(json.dumps(updated, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
