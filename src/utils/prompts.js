export const commitPrompts = [
  {
    type: 'select', // Updated from 'list' to 'select'
    name: 'type',
    message: 'Select the type of change you are committing:',
    choices: [
      { name: 'feat:     A new feature', value: 'feat' },
      { name: 'fix:      A bug fix', value: 'fix' },
      { name: 'docs:     Documentation only changes', value: 'docs' },
      { name: 'style:    Changes that do not affect the meaning of the code', value: 'style' },
      { name: 'refactor: A code change that neither fixes a bug nor adds a feature', value: 'refactor' },
      { name: 'test:     Adding missing tests or correcting existing tests', value: 'test' },
      { name: 'chore:    Changes to the build process or auxiliary tools', value: 'chore' }
    ]
  },
  {
    type: 'input',
    name: 'scope',
    message: 'Enter the scope of this change (e.g., component or file name) [optional]:',
  },
  {
    type: 'input',
    name: 'description',
    message: 'Write a short, imperative tense description of the change:',
    validate: (input) => input.length > 0 ? true : 'Description cannot be empty.'
  }
];

