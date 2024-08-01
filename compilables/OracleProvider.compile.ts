import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/oracle-provider.tact',
    options: {
        debug: true
    }
};
