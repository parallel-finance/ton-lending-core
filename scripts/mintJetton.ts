import { Address, toNano } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import {SampleJetton} from "../build/SampleJetton/tact_SampleJetton";

export async function run(provider: NetworkProvider, args: string[]) {
    const userAddress = Address.parse(provider.sender().address?.toString() || '');
    const ui= provider.ui();

    const address = Address.parse('EQBgTTj_q3OVw9a8qVukPpN0IChMH-ZcL7Vj-zXlRF6Llc_3');

    if (!(await provider.isContractDeployed(address))) {
        ui.write(`Error: Contract at address ${address} is not deployed!`);
        return;
    }

    const sampleJetton = provider.open(SampleJetton.fromAddress(address));

    await sampleJetton.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Mint',
            receiver: userAddress,
            amount: 1000000000000n,
        }
    );
    console.log(`Minted 1000000000000n SAM to ${userAddress.toString()}`);
}
