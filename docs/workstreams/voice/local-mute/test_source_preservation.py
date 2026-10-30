"""Actual ACK, request and owner preservation without a compiler or runtime."""
import unittest
import generate_local_mute as proposal

before = proposal.originals[proposal.CHAT]
after = proposal.outputs[proposal.CHAT]
def section(source, start, end):
    begin = source.index(start)
    return source[begin:source.index(end,begin)]

class SourcePreservation(unittest.TestCase):
    def test_fixture_has_native_original_turn_join_required_before_capture(self):
        fixture = proposal.outputs['apps/web/src/features/voice-ui/LocalMute.test.tsx']
        self.assertIn('active_utterance_id:turnId,turn_request_id:turnId',fixture)
        self.assertIn('state.state !== "listening" && !text(state.turn_request_id)',after)

    def test_playback_claim_and_ended_ack_implementation_are_byte_exact(self):
        self.assertEqual(section(before,'  const playReply =','  const accept ='),section(after,'  const playReply =','  const accept ='))

    def test_existing_original_poll_and_control_implementation_are_preserved(self):
        self.assertEqual(section(before,'  const checkOriginal =','  const checkRef ='),section(after,'  const checkOriginal =','  const checkRef ='))
        self.assertEqual(section(before,'  const control =','  controlRef.current ='),section(after,'  const control =','  controlRef.current ='))

    def test_local_mute_never_invalidates_call_or_stops_playback(self):
        mute = section(after,'  const muteMic =','  const uncertain =')
        release = section(after,'  const releaseCapture =','  const releaseMic =')
        for forbidden in ('generation.current++','watching.current =','pausedRef.current =','stopPlayback(','request(','save(','control('):
            self.assertNotIn(forbidden,mute+release)
        self.assertIn('releaseCapture();',mute)

    def test_unmute_has_no_mutating_api_route_or_alternate_owner(self):
        unmute = section(after,'  const unmuteMic =','  const start =')
        self.assertNotIn('"POST"',unmute)
        self.assertNotIn('generation.current++',unmute)
        self.assertNotIn('setBusy(true)',unmute)
        for proof in ('originalView.id !== original.sessionId','originalView.project_id !== projectId',
            'originalView.session_id !== sessionId','ownerMatches(owner)',
            'JSON.stringify(originalView.owner) !== JSON.stringify(owner)',
            'originalView.voice !== observed.current?.voice','originalView.send_transcripts !== true',
            'caps.backend !== capabilities.backend','freshSegmented !== segmented','retainedSource.current','captureDevice.current.current(ticket)'):
            self.assertIn(proof,unmute)

    def test_capture_acquisition_uses_only_its_own_epoch(self):
        acquire = section(after,'  const acquireMic =','  const unmuteMic =')
        self.assertNotIn('++generation.current',acquire)
        self.assertNotIn('generation.current++',acquire)
        self.assertIn('generation.current === callStamp',acquire)
        self.assertIn('captureDevice.current.open(ticket',acquire)
        self.assertIn('lease.claim(micToken.current)',acquire)

    def test_global_end_and_disconnect_still_fence_playback_with_recovery(self):
        release = section(after,'  const releaseMic =','  const muteMic =')
        self.assertIn('generation.current++',release)
        self.assertIn('watching.current = false',release)
        self.assertIn('const stop = () => { releaseMic(); stopPlayback();',after)
        self.assertEqual(before.count('request("POST"'),after.count('request("POST"'))
        self.assertIn('const wasWatching = watching.current; releaseMic(); stopPlayback();',after)

    def test_only_local_capture_domain_and_existing_action_names_change(self):
        self.assertTrue(all(path.startswith('apps/web/src/features/') for path in proposal.outputs))
        for action in ('Export complete unsubmitted capture','Discard unsubmitted capture','Check original voice session and controls','Stop voice chat'):
            self.assertIn(action,after)
        self.assertIn('onClick={() => { if (monitoring || micPending) muteMic();',after)
        self.assertIn('aria-pressed={micReleaseUnknown ? undefined : monitoring}',after)
        self.assertIn('micReleaseUnknown ? "Mic unknown"',after)

if __name__ == '__main__':
    unittest.main()
