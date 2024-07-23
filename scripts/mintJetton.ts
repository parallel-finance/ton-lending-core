import { Address, toNano } from '@ton/core';
import { NetworkProvider, sleep } from '@ton/blueprint';
import {SampleJetton} from "../build/SampleJetton/tact_SampleJetton";

export async function run(provider: NetworkProvider, args: string[]) {
    const userAddress = Address.parse(provider.sender().address?.toString() || '');
    const ui= provider.ui();

    // MAS: EQCP_v_hh0uTHIG_j6jpynQhazw3m1ZyEPR_aQMQTAsHMPxA
    // NOT: EQBqFJkn_DoBFcNPQ0ble53CD92X_XsDgPr1_WAajYceJMHi
    // PTon: EQBdMo5ZwwVWhBMMSNbU9oNe3L5B8GBhl14OD8aR9am2lv2-
    // USDT: EQAXwaSn8OPKA08QgSBPVGvP5n_stP9PhuRvynayN-pnjKXb
    const address = Address.parse(args.length > 0 ? args[0] : await ui.input('SampleJetton address'));

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
            queryId: 0n,
            token: sampleJetton.address,
            receiver: userAddress,
            amount: 1000000000000n,
        }
    );
    console.log(`Minted 1000000000000n token to ${userAddress.toString()}`);
}
