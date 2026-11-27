"""Build the public changelog for a candidate Dalecrest release."""

import argparse
import json
import re
import subprocess
from datetime import date
from html import escape
from itertools import groupby
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
TOPICS = [(name, re.compile(pattern, re.I)) for name, pattern in (
    ("Development updates", r"\b(?:changelog|development (?:changes|notes|updates)|release (?:notes|summaries))\b"),
    ("Dalecrest Daily", r"\b(?:the Daily|Dalecrest Daily|daily (?:archive|search|editions?|editor)|newspaper)\b"),
    ("Robin’s Journal", r"\b(?:Robin|songwriting|songs?|verses?)\b"),
    ("Map and Walk", r"\b(?:map|walk|camera|zoom|pinch|paths?|portraits?)\b"),
    ("Village decisions", r"\b(?:moots?|ballots?|promises?|goals?|choices?|decisions?)\b"),
)]
PAST_TENSE = {
    "add": "added", "allow": "allowed", "ask": "asked", "bring": "brought", "enable": "enabled", "expand": "expanded",
    "fix": "fixed", "give": "gave", "group": "grouped", "improve": "improved", "keep": "kept", "land": "landed", "let": "let",
    "make": "made", "move": "moved", "open": "opened", "publish": "published", "record": "recorded",
    "remove": "removed", "restore": "restored", "schedule": "scheduled", "show": "showed", "slim": "slimmed", "store": "stored",
    "summarize": "summarized", "support": "added support for", "turn": "turned", "update": "updated",
}
MAX_HIGHLIGHTS = 3
# A later verb in a commit subject follows a comma, with or without "and": "Store X, slim Y, ask Z".
LATER_VERB = re.compile(r", (and )?([a-z]+)\b")
REVISION = re.compile(r"[0-9a-f]{40}")


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


def with_release(history, day, revision, changes):
    seen = {note["sha"] for notes in history.values() for note in notes}
    new = [{**note, "release": revision} for note in changes if note["sha"] not in seen]
    if new:
        return {**history, day: new + history.get(day, [])}
    return history


def recover_release_ids(history, archive):
    missing = {note["sha"]: note for notes in history.values() for note in notes if "release" not in note}
    if not missing:
        return
    snapshots = sorted((path for path in archive.glob("*.json") if REVISION.fullmatch(path.stem)),
                       key=lambda path: path.stat().st_mtime_ns)
    # A commit first appears in the history snapshot of the deploy that published it.
    for path in snapshots:
        try:
            earlier = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for notes in earlier.values():
            for note in notes:
                original = missing.pop(note["sha"], None)
                if original is not None:
                    original["release"] = note.get("release", path.stem)
        if not missing:
            break


def note_link(note):
    return f'<a href="{COMMIT_URL}{escape(note["sha"])}">{escape(note["title"])}</a>'


def note_list(notes):
    items = "".join(f"\n          <li>{note_link(note)}</li>" for note in notes)
    return f'<ul class="development-changes">{items}\n        </ul>'


def group_topics(changes):
    groups = {}
    for change in changes:
        topic = next((name for name, pattern in TOPICS if pattern.search(change["title"])), "Village life")
        groups.setdefault(topic, []).append(change)
    return groups


def later_verbs(rest):
    """Put each listed verb after a comma in the past tense, and join the last of them with "and"."""
    hits = [match for match in LATER_VERB.finditer(rest) if match[2] in PAST_TENSE]
    parts, last = [], 0
    for index, match in enumerate(hits):
        joiner = " and " if match[1] or index == len(hits) - 1 else ", "
        parts += [rest[last:match.start()], joiner, PAST_TENSE[match[2]]]
        last = match.end()
    return "".join(parts) + rest[last:], bool(hits)


def release_summary(groups):
    # Cover each highlighted topic before using the remaining space for related changes.
    topics = list(groups)[:MAX_HIGHLIGHTS]
    remaining = MAX_HIGHLIGHTS - len(topics)
    sentences = []
    subject = "Dalecrest "
    for topic in topics:
        titles = list(dict.fromkeys(note["title"].rstrip(".!?") for note in groups[topic]))
        take = min(len(titles), 1 + remaining)
        remaining -= take - 1
        clauses, other = [], []
        has_compound = False
        for title in titles[:take]:
            verb, _, rest = title.partition(" ")
            if rest and verb.lower() in PAST_TENSE:
                readable, compound = later_verbs(rest)
                has_compound |= compound
                clauses.append(f"{PAST_TENSE[verb.lower()]} {readable}")
            else:
                other.append(title + ".")
        if clauses:
            separator = ", and " if len(clauses) > 2 or has_compound else " and "
            text = separator.join([", ".join(clauses[:-1]), clauses[-1]]) if len(clauses) > 1 else clauses[0]
            sentences.append(subject + text + ".")
            subject = "It also "
        sentences.extend(other)
    return ", ".join(topics), " ".join(sentences)


def render_release(changes, heading):
    groups = group_topics(changes)
    title, summary = release_summary(groups)
    count = len(changes)
    details = "".join(f"<div><strong>{escape(topic)}</strong>{note_list(notes)}</div>" for topic, notes in groups.items())
    commits = "commit" if count == 1 else "commits"
    return f'''
        <section class="development-release">
          <{heading}>{escape(title)}</{heading}>
          <p>{escape(summary)}</p>
          <details>
            <summary>View {count} {commits}</summary>
            {details}
          </details>
        </section>'''


def render_page(template, history):
    if template.count(INSERT) != 1:
        raise ValueError("The development page needs one release-note insertion point.")
    articles = []
    for day, notes in sorted(history.items(), reverse=True):
        when = date.fromisoformat(day)
        slot = f"<!-- development-notes:{day} -->"
        heading = "h3" if slot in template else "h2"
        # Older history was stored as one list per date. It still renders as a dated summary.
        releases = "".join(render_release(list(changes), heading) for _, changes in groupby(notes, lambda note: note.get("release")))
        if slot in template:
            template = template.replace(slot, releases.strip(), 1)
            continue
        articles.append(f'''
    <article class="development-entry" id="{day}">
      <time datetime="{day}">{when.day} {when:%B %Y}</time>
      <div>{releases}
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
        recover_release_ids(history, args.history.parent)
        base = args.previous
    else:
        history = {}
        base = BACKFILLED_THROUGH
    changes = release_changes(args.repo, base, args.revision)
    updated = with_release(history, args.date.isoformat(), args.revision, changes)
    args.page.write_text(render_page(args.page.read_text(encoding="utf-8"), updated), encoding="utf-8")
    args.output_history.write_text(json.dumps(updated, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
