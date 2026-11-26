import importlib.util
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
        backfilled = notes.with_release({}, "2026-11-26", [first])
        same_day = notes.with_release(backfilled, "2026-11-26", [second, first])
        next_day = notes.with_release(same_day, "2026-11-27", [{"sha": "3" * 40, "title": "Open the alehouse"}])
        self.assertEqual(backfilled["2026-11-26"], [first])
        self.assertEqual(same_day["2026-11-26"], [second, first])
        self.assertEqual(notes.with_release(next_day, "2026-11-28", []), next_day)

        html = notes.render_page(source, next_day)
        self.assertEqual(html.count('id="2026-11-26"'), 1)
        self.assertLess(html.index("Open the alehouse"), html.index("The first family arrives"))
        self.assertIn("Add a map &amp; a &lt;preview&gt;", html)
        self.assertIn("Dalecrest opens", html)
        self.assertNotIn(notes.INSERT, html)


if __name__ == "__main__":
    unittest.main()
