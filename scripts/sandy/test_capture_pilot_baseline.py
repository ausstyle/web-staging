import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from capture_pilot_baseline import capture, PILOT_EMAIL
PILOT_USER="10000000-0000-4000-8000-000000000001"

class Reply(io.BytesIO):
    status=200
    def __init__(self,value):super().__init__(json.dumps(value).encode())

class PilotCapture(unittest.TestCase):
    def test_other_customer_or_engineering_identity_cannot_start_a_turn(self):
        class Opener:
            calls=0
            def open(self,*args,**kwargs):
                self.calls+=1
                return Reply({"id":"foreign-user","email":"other@example.invalid","email_confirmed_at":"2026-10-21T00:00:00Z"})
        opener=Opener()
        with patch("urllib.request.build_opener",return_value=opener), tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError,"normal_pilot_authentication_required"):
                capture("fixture-token",{"cases":[]},Path(folder)/"evidence.json")
        self.assertEqual(opener.calls,1)
    def test_uncertain_accepted_turn_is_recorded_without_replay(self):
        class Opener:
            calls=0
            def open(self,request,**kwargs):
                self.calls+=1
                if self.calls==1:return Reply({"id":PILOT_USER,"email":PILOT_EMAIL,"email_confirmed_at":"2026-10-21T00:00:00Z"})
                if self.calls==2:return Reply({"conversation_id":"fixture-conversation"})
                raise urllib.error.HTTPError(request.full_url,502,"uncertain",{},None)
        opener=Opener();cohort={"version":"fixture","cases":[{"case_id":"P0-007","request":"How many tasks?"}]}
        with patch("urllib.request.build_opener",return_value=opener), tempfile.TemporaryDirectory() as folder:
            output=Path(folder)/"evidence.json"
            result=capture("fixture-token",cohort,output)
            self.assertEqual(result["captured_cases"],1)
            self.assertFalse(json.loads(output.read_text())["acceptance_passed"])
            self.assertEqual(opener.calls,3)

if __name__=="__main__":unittest.main()
