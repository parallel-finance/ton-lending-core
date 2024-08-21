import { Address, beginCell, Builder, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type JettonWalletConfig = {
    owner: Address;
    minter: Address;
    walletCode: Cell;
};

export function jettonWalletConfigToCell(config: JettonWalletConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.owner)
        .storeAddress(config.minter)
        .storeRef(config.walletCode)
        .endCell();
}

export class JettonWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }

    static createFromConfig(config: JettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config);
        const init = { code, data };
        return new JettonWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        forwardValue: bigint,
        recipient: Address,
        amount: bigint,
        forwardPayload: Cell
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x3ee943f1, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(recipient)
                .storeAddress(via.address)
                .storeUint(0, 1)
                .storeCoins(forwardValue)
                .storeUint(1, 1)
                .storeRef(forwardPayload)
                .endCell(),
            value: value + forwardValue,
        });
    }

    async sendTransfer2(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        queryId: bigint,
        amount: bigint,
        destination: Address,
        customPayload: Cell | null,
        forwardTonAmount: bigint,
        forwardPayload: Cell
    ) {
        const storeTokenTransferBody = () => {
            let b_0 = beginCell()
            b_0.storeUint(0x3ee943f1, 32);
            b_0.storeUint(queryId, 64);
            b_0.storeCoins(amount);
            b_0.storeAddress(destination);
            b_0.storeAddress(via.address);
            // if (customPayload !== null && customPayload !== undefined) { b_0.storeBit(true).storeRef(customPayload); } else { b_0.storeBit(false); }
            b_0.storeRef(Cell.EMPTY)
            b_0.storeCoins(forwardTonAmount);
            b_0.storeRef(forwardPayload)
            return b_0.endCell()
        };

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: storeTokenTransferBody(),
            // .storeTokenTransferBody
            // .storeUint(0x3ee943f1, 32) // op::transfer
            // .storeUint(0, 64)
            // .storeCoins(amount)
            // .storeAddress(destination)
            // .storeAddress(via.address)
            // .storeUint(0, 1)
            // .storeCoins(forwardValue)
            // .storeUint(1, 1)
            // .storeRef(forwardPayload)
            // .endCell(),
            value: forwardTonAmount + value
        });
    }

    async getJettonBalance(provider: ContractProvider) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_wallet_data', []);
        return res.stack.readBigNumber();
    }
}
