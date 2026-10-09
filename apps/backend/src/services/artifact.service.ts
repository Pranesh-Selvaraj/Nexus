import type { ArtifactKind } from '@nexus/shared-types';

import { assertChatConfigured } from './embedding.service.js';
import { getOpenAIClient, sessionHeaders } from './openai-client.js';
import { getSetting } from './settings.service.js';

/** Prompt metadata per studio artifact kind. */
export const ARTIFACT_META: Record<
  ArtifactKind,
  { title: string; instruction: string }
> = {
  summary: {
    title: 'Summary',
    instruction:
      'Write a tight summary of the material: 1 short paragraph, then 5-8 bullet points covering the key ideas in order.',
  },
  study_guide: {
    title: 'Study guide',
    instruction:
      'Write a study guide: an overview paragraph, then sections with the key concepts, each with a one-line explanation and a self-test question, and finish with a 5-item checklist of what to practice.',
  },
  glossary: {
    title: 'Glossary',
    instruction:
      'Write a glossary as a Markdown table with the columns Term and Definition. Include every important term in the material, alphabetically.',
  },
  mindmap: {
    title: 'Mind map',
    instruction:
      'Write a Mermaid mindmap diagram (a ```mermaid fenced block starting with "mindmap") that maps the material’s main topic to its key subtopics and ideas.',
  },
};

const SYSTEM_PROMPT = [
  'You create a learning artifact from source material.',
  'Ground everything in the material and reply with Markdown only - no commentary outside the artifact.',
  'This is a learning artifact task.',
].join(' ');

/** Generate one artifact as Markdown; callers store the result. */
export async function generateArtifact(
  kind: ArtifactKind,
  sourceText: string,
  sessionId?: string,
): Promise<string> {
  await assertChatConfigured();
  const client = await getOpenAIClient('chat');
  const model = await getSetting('openai.model');
  const meta = ARTIFACT_META[kind];

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Artifact kind: ${kind}\n${meta.instruction}\n\nSource material:\n\n${sourceText.slice(0, 12000)}`,
        },
      ],
    },
    sessionId ? sessionHeaders(sessionId) : undefined,
  );

  return (completion.choices[0]?.message?.content ?? '').trim();
}
