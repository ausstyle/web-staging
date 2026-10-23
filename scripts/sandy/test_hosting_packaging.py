"""Offline release-input regressions. Real nginx behavior uses the preview check."""
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class HostingPackagingTests(unittest.TestCase):
    def test_all_build_images_are_digest_pinned(self):
        docker = (ROOT / 'sandy/Dockerfile').read_text()
        self.assertRegex(docker.splitlines()[0], r'^FROM nginx:1\.27-alpine@sha256:[a-f0-9]{64}$')
        builders = re.findall(r"name: '([^']+)'", (ROOT / 'sandy/cloudbuild.yaml').read_text())
        self.assertEqual(len(builders), 2)
        for image in builders:
            self.assertRegex(image, r'^gcr.io/cloud-builders/docker@sha256:[a-f0-9]{64}$')

    def test_source_commit_guard_rejects_unset_tags_and_shell_input(self):
        build = (ROOT / 'sandy/cloudbuild.yaml').read_text()
        script = build.split('      - |\n', 1)[1].split('  - name:', 1)[0]
        script = '\n'.join(line[8:] for line in script.splitlines()).replace('$$', '$')
        for value, accepted in [('a' * 40, True), ('UNSET', False), ('a' * 39, False),
                                ('A' * 40, False), ('g' * 40, False), ('$(exit 0)', False),
                                ('a' * 39 + '\n', False), ('a' * 40 + ';true', False)]:
            with self.subTest(value=value):
                result = subprocess.run(['sh', '-ceu', script], env={**os.environ, 'SOURCE_SHA': value}, capture_output=True)
                self.assertEqual(result.returncode == 0, accepted)

    def test_build_target_and_provenance(self):
        build = (ROOT / 'sandy/cloudbuild.yaml').read_text()
        self.assertIn('europe-west8-docker.pkg.dev/elaborate-haven-511518-a5/sandy-web/sandy-marketing:${_SOURCE_SHA}', build)
        self.assertIn('requestedVerifyOption: VERIFIED', build)
        self.assertNotIn("args: ['push'", build)
        self.assertNotIn('gcloud run deploy', build)

    def test_only_public_page_is_copied(self):
        docker = (ROOT / 'sandy/Dockerfile').read_text()
        copies = [line for line in docker.splitlines() if line.startswith('COPY ')]
        self.assertEqual(copies, ['COPY --chmod=0644 cloud-run-nginx.conf /etc/nginx/conf.d/default.conf',
                                  'COPY --chmod=0644 index.html /usr/share/nginx/html/index.html'])
        self.assertEqual((ROOT / 'sandy/.dockerignore').read_text().splitlines(),
                         ['**', '!Dockerfile', '!cloud-run-nginx.conf', '!index.html'])


if __name__ == '__main__':
    unittest.main()
