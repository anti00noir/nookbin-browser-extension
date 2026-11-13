// Roster of NookSuite tools.
//
// The single source of truth for the website's tool section: build.mjs
// renders these entries into dist/index.html. Keep entries in sync when a
// tool is added or its status changes.

export const tools = [
  {
    id: 'nookbin',
    name: 'NookBin',
    tagline: 'Keep the documents you reuse one keystroke away.',
    description:
      'A floating panel in your browser that stores the files you send often and drops them straight into any page\u2019s upload field \u2014 no file-picker round trip.',
    status: 'shipped',
    version: '0.2.0',
    targets: ['Chrome (MV3)'],
  },
  {
    id: 'nookedit',
    name: 'NookEdit',
    tagline: 'Light-touch edits right before a file leaves your hands.',
    description:
      'Editing tools built around the suite\u2019s file flows. In planning.',
    status: 'planned',
    targets: ['Browser', 'Native'],
  },
  {
    id: 'nooknotes',
    name: 'NookNotes',
    tagline: 'Short notes that live beside your files.',
    description:
      'A quick place for the notes you keep rewriting. In planning.',
    status: 'planned',
    targets: ['Browser', 'Native'],
  },
];
