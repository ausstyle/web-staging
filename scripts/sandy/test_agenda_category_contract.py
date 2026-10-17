"""Offline regression checks for Sandy Agenda nested company categories."""
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
UI = ROOT / "sandy" / "agenda" / "index.html"
API = ROOT / "supabase" / "functions" / "sandy-agenda" / "index.ts"
MIGRATION = ROOT / "supabase" / "migrations" / "20261017174534_sandy_agenda_nested_company_categories.sql"


class AgendaNestedCategoryContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = UI.read_text(encoding="utf-8")
        cls.backend = API.read_text(encoding="utf-8")
        cls.migration = MIGRATION.read_text(encoding="utf-8")

    def test_frontend_js_syntax(self):
        match = re.search(r'<script type="module">([\s\S]*?)</script>', self.html)
        self.assertIsNotNone(match, "Agenda module script missing")
        self.assertIsNotNone(shutil.which("node"), "Node.js required for JavaScript syntax check")
        with tempfile.TemporaryDirectory() as tmp:
            js = pathlib.Path(tmp) / "agenda.mjs"
            js.write_text(match.group(1), encoding="utf-8")
            result = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_ui_exposes_company_category_navigation_and_task_assignment(self):
        for name in ('id="categoryBar"', 'id="taskCategoryField"', 'id="taskCategory"',
                     "function renderCategories()", "function useEntryWorkspace(", "function categoryIsWithin(",
                     'api("category-create"', 'api("category-update"',
                     'api("category-delete"', 'category_id:$("taskCategory").value||null'):
            self.assertIn(name, self.html, name)

    def test_api_enforces_tenant_scoping_and_category_inheritance(self):
        for name in ('action==="category-create"', 'action==="category-update"',
                     'action==="category-delete"', 'eq("customer_id",cid)',
                     'function categoryValid(', 'category_id:parent.category_id',
                     'sandy_task_create_categorized_bundle', 'fields.category_id=newCategory',
                     "categories:categories.data||[]"):
            self.assertIn(name, self.backend, name)

    def test_sql_contains_relationship_integrity(self):
        for name in ('sandy_agenda_categories', 'parent_category_id',
                     'sandy_tasks_category_tenant_company_fk', 
                     'sandy_agenda_category_prevent_cycle',
                     'enable row level security', 'revoke all',
                     'sandy_task_create_categorized_bundle'):
            self.assertIn(name, self.migration, name)


if __name__ == "__main__":
    unittest.main()
