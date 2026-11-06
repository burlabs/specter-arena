import { App, type AppProps, DefaultStackSynthesizer } from 'aws-cdk-lib';
import { CDK_QUALIFIER, PREVIEW_ACCOUNT, PREVIEW_REGION } from './preview-config.ts';
import { PreviewStack } from './preview-stack.ts';

export const PREVIEW_STACK_NAME = 'SpecterArenaPreview';

/**
 * The stack pins its account, so CDK refuses to deploy it with credentials for any
 * other account, and its synthesizer uses the `specter` bootstrap qualifier.
 */
export function createPreviewApp(props: AppProps = {}): { app: App; stack: PreviewStack } {
  const app = new App(props);
  const stack = new PreviewStack(app, PREVIEW_STACK_NAME, {
    env: { account: PREVIEW_ACCOUNT, region: PREVIEW_REGION },
    synthesizer: new DefaultStackSynthesizer({ qualifier: CDK_QUALIFIER }),
    description: 'Specter Arena per-PR preview hosting',
  });
  return { app, stack };
}
