"""Pure metadata/connection fixtures: no sockets, children, models or kernel calls."""
import base64
import copy
import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import managed_api_tree as api
import managed_recovery_witness as witness


def inputs():
    owner = dict(instanceId="voice-test", bootId="00000000-0000-4000-8000-000000000001",
                 ownerId="00000000-0000-4000-8000-000000000002", ownerGeneration=1,
                 leaseId="00000000-0000-4000-8000-000000000003")
    endpoint = "veyra-cpu-" + hashlib.sha256((owner["ownerId"] + "\0" + owner["leaseId"]).encode()).hexdigest()
    request = dict(version=1, controlOperationId="00000000-0000-4000-8000-000000000004", owner=owner,
                   recoveryEndpointIdentity=endpoint, retirementSecretSha256=hashlib.sha256(bytes(32)).hexdigest(),
                   requireParentExit=True, deadlineMs=1000)
    proof = dict(version=1, controlOperationId=request["controlOperationId"], owner=copy.deepcopy(owner),
                 recoveryEndpointIdentity=endpoint, treeEmpty=True, pipeEof=True, leaderWaited=True,
                 noStartSealed=False, parentExited=True, reaped=1, retirementSecret=base64.b64encode(bytes(32)).decode())
    return request, proof


class RecoveryTests(unittest.TestCase):
    def test_authentication_binds_original_and_removes_secret(self):
        request, proof = inputs()
        self.assertIs(witness.original_request(request), request)
        result = witness.authenticate_retirement(request, proof)
        self.assertNotIn("retirementSecret", result)
        for field, value in (("treeEmpty", False), ("pipeEof", False), ("parentExited", False),
                             ("reaped", 0), ("retirementSecret", base64.b64encode(bytes([1]) * 32).decode()),
                             ("controlOperationId", request["owner"]["ownerId"])):
            with self.subTest(field=field), self.assertRaises(ValueError):
                witness.authenticate_retirement(request, {**proof, field: value})

    def test_closed_no_start_requires_explicit_seal_and_original_binding(self):
        request, proof = inputs()
        proof.update(noStartSealed=True, leaderWaited=False, parentExited=False, reaped=0)
        self.assertTrue(witness.authenticate_retirement(request, proof)["noStartSealed"])
        proof["noStartSealed"] = False
        with self.assertRaises(ValueError):
            witness.authenticate_retirement(request, proof)
        for change in ({"deadlineMs": True}, {"version": True}, {"extra": 1}, {"recoveryEndpointIdentity": "other"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                witness.original_request({**request, **change})

    def test_disconnected_reader_keeps_same_original_rendezvous(self):
        tree = object.__new__(api.ApiOriginalTree)
        tree.retirement_retained = False
        tree.proof = Mock(return_value={"held": "proof"})
        tree.listener = Mock()
        tree.listener.accept.side_effect = [(object(), None), (object(), None)]
        def exchange(*_):
            if tree._retirement_connection.call_count == 1:
                raise BrokenPipeError("reader disconnected")
            tree.retirement_retained = True
        tree._retirement_connection = Mock(side_effect=exchange)
        tree.retirement_server()
        self.assertEqual(tree._retirement_connection.call_count, 2)
        tree.proof.assert_called_once()
        tree.listener.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
