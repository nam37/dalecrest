import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("development_notes", HERE / "development-notes.py")
notes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notes)


class DevelopmentNotesTest(unittest.TestCase):
    def test_paths_and_subjects_keep_visitor_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output([
                    "git", "-C", directory, "-c", "user.name=Test", "-c", "user.email=test@example.test", *args,
                ], encoding="utf-8").strip()

            def commit(path, title):
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(title, encoding="utf-8")
                git("add", path)
                git("commit", "-qm", title)
                return git("rev-parse", "HEAD")

            git("init", "-q")
            base = commit("public/index.html", "Launch the observatory")
            published = commit("public/index.html", "feat(map): Turn the mill wheel")
            commit("docs/design.md", "Improve the design guide")
            commit("admin-ui/index.html", "Show the admin clock")
            commit("public/style.css", "refactor(css): Group repeated styles")
            commit("engine/season.mjs", "Try a new weather value [skip changelog]")
            latest = commit("engine/season.mjs", "Give the fields a frost")
            git_dir = root / ".git"
            self.assertEqual(notes.release_changes(git_dir, base, latest), [
                {"sha": latest, "title": "Give the fields a frost"},
                {"sha": published, "title": "Turn the mill wheel"},
            ])

    def test_notes_follow_successful_history_and_keep_the_backfill(self):
        source = (HERE.parent / "public" / "development.html").read_text(encoding="utf-8")
        first = {"sha": "1" * 40, "title": "Add a map & a <preview>"}
        second = {"sha": "2" * 40, "title": "Give Robin another route"}
        backfilled = {"2026-11-26": [first]}
        same_day = notes.with_release(backfilled, "2026-11-26", second["sha"], [second, first])
        next_day = notes.with_release(same_day, "2026-11-27", "3" * 40, [{"sha": "3" * 40, "title": "Open the alehouse"}])
        self.assertEqual(backfilled["2026-11-26"], [first])
        self.assertEqual(same_day["2026-11-26"], [{**second, "release": second["sha"]}, first])
        self.assertEqual(notes.with_release(next_day, "2026-11-28", "4" * 40, []), next_day)

        html = notes.render_page(source, next_day)
        self.assertEqual(html.count('id="2026-11-26"'), 1)
        self.assertLess(html.index("Dalecrest opened the alehouse."), html.index("The first family arrives"))
        self.assertIn("Add a map &amp; a &lt;preview&gt;", html)
        self.assertIn("Dalecrest opens", html)
        self.assertEqual(html.count('class="development-release"'), 3)
        self.assertNotIn(notes.INSERT, html)

    def test_related_changes_become_a_short_summary_and_keep_all_commit_links(self):
        changes = [
            {"sha": "1" * 40, "title": "Show the village’s days on the map, and fix dotted paths"},
            {"sha": "2" * 40, "title": "Improve pinch-to-zoom on phones"},
            {"sha": "3" * 40, "title": "Open search in the Daily archive"},
            {"sha": "4" * 40, "title": "Fix a map label near the mill"},
        ]
        groups = notes.group_topics(changes)
        self.assertEqual(notes.release_summary(groups), (
            "Map and Walk, Dalecrest Daily",
            "Dalecrest showed the village’s days on the map and fixed dotted paths, and improved pinch-to-zoom on phones. "
            "It also opened search in the Daily archive.",
        ))
        html = notes.render_release(changes, "h2")
        self.assertIn("<summary>View 4 commits</summary>", html)
        self.assertNotIn("<details open", html)
        for change in changes:
            self.assertIn(notes.COMMIT_URL + change["sha"], html)

    def test_old_snapshots_recover_separate_deploys_on_the_same_day(self):
        first = {"sha": "1" * 40, "title": "Add a day dial to the map"}
        second = {"sha": "2" * 40, "title": "Show night lanterns on the map"}
        third = {"sha": "3" * 40, "title": "Show a turning mill wheel on the map"}
        day = "2026-11-26"
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory)
            for index, (revision, entries) in enumerate([(first["sha"], [first]), (third["sha"], [third, second, first])], 1):
                path = archive / (revision + ".json")
                path.write_text(json.dumps({day: entries}), encoding="utf-8")
                os.utime(path, (index, index))
            history = {day: [dict(third), dict(second), dict(first)]}
            notes.recover_release_ids(history, archive)
        self.assertEqual([note["release"] for note in history[day]], [third["sha"], third["sha"], first["sha"]])
        template = (HERE.parent / "public" / "development.html").read_text(encoding="utf-8")
        page = notes.render_page(template, history)
        self.assertIn("<summary>View 2 commits</summary>", page)
        self.assertEqual(page.count('class="development-release"'), 2)


if __name__ == "__main__":
    unittest.main()
