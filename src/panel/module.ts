import { PanelPlugin } from '@grafana/data';

import { BrygeChatPanel } from './components/BrygeChatPanel';
import { BrygeChatOptions } from './types';

export const plugin = new PanelPlugin<BrygeChatOptions>(BrygeChatPanel).setPanelOptions((builder) =>
  builder
    .addTextInput({
      path: 'brygeDatasourceId',
      name: 'Database',
      description:
        "Which connected database to answer from. Filled in by the app's setup page — leave it alone unless you want this one panel to answer from a different database.",
      defaultValue: '',
    })
    .addTextInput({
      path: 'starterQuestion',
      name: 'Suggested question',
      description: 'Offered as a one-click starter while the conversation is empty.',
      defaultValue: 'What stands out in this data?',
    })
    .addBooleanSwitch({
      path: 'showChart',
      name: 'Draw the results',
      description: 'Plot the rows behind each answer, using the dashboard time range.',
      defaultValue: true,
    })
    .addNumberInput({
      path: 'maxRows',
      name: 'Max rows',
      defaultValue: 5000,
    })
);
