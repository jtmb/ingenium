"""No compile/render/runtime: prove the delta leaves the effect-bearing source intact."""
from collections import Counter
import unittest
import generate_presentation as proposal

def attributes(source, name):
    marker = name + '={'
    found = []
    position = 0
    while marker in source[position:]:
        start = source.index(marker, position) + len(marker)
        depth, quote, escaped, index = 1, None, False, start
        while depth:
            char = source[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == quote:
                    quote = None
            elif char in ('"', "'", '`'):
                quote = char
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            index += 1
        found.append(source[start:index-1])
        position = index
    return Counter(found)

class SourcePreservation(unittest.TestCase):
    def test_all_chat_handlers_and_owner_effects_are_byte_preserved(self):
        before = proposal.originals[proposal.CHAT].split('  return <AttentionDetails className="wb-voice-chat"',1)[0]
        after = proposal.outputs[proposal.CHAT].split('  const activeUtterance =',1)[0]
        after = after.removeprefix('import { callPresentation } from "../voice-ui/call-presentation.mjs";\nimport "./VoiceCall.css";\n')
        after = after.replace('import { Mic, Square, Volume2, X }','import { Mic, Square, Volume2 }')
        self.assertEqual(before,after)

    def test_every_inline_click_change_and_disabled_guard_survives(self):
        for path in (proposal.CHAT, proposal.WORKSPACE):
            for name in ('onClick','onChange','disabled'):
                with self.subTest(path=path,attribute=name):
                    self.assertEqual(attributes(proposal.originals[path],name),attributes(proposal.outputs[path],name))

    def test_workspace_lease_and_attention_ownership_are_preserved(self):
        before = proposal.originals[proposal.WORKSPACE].split('  return <section',1)[0]
        after = proposal.outputs[proposal.WORKSPACE].split('  return <section',1)[0]
        self.assertEqual(before,after.removeprefix('import { AudioLines } from "lucide-react";\n'))
        self.assertIn('onPresentationNeeded={setVoiceNeeded}',proposal.outputs[proposal.WORKSPACE])
        self.assertIn('onPresentationNeeded={setSpeechNeeded}',proposal.outputs[proposal.WORKSPACE])

    def test_no_simulated_waveform_motion_or_media_source(self):
        css = proposal.outputs['apps/web/src/features/workbench/VoiceCall.css']
        for forbidden in ('@keyframes','animation:','pointer-events:none','url('):
            self.assertNotIn(forbidden,css)
        self.assertIn(':focus-visible',css)
        self.assertIn('@media(max-width:540px)',css)
        self.assertIn('aria-hidden="true"',proposal.outputs[proposal.CHAT])

    def test_effectful_nonpresentation_domains_are_outside_delta(self):
        self.assertTrue(all(path.startswith('apps/web/src/features/') for path in proposal.outputs))
        self.assertNotIn('crates/', '\n'.join(proposal.outputs))
        self.assertIn('Export complete unsubmitted capture',proposal.outputs[proposal.CHAT])
        self.assertIn('Discard unsubmitted capture',proposal.outputs[proposal.CHAT])
        self.assertIn('aria-label="Check original voice session and controls"',proposal.outputs[proposal.CHAT])

if __name__ == '__main__':
    unittest.main()
