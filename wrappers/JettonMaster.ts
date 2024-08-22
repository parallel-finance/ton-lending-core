import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, internal as internal_relaxed, storeMessageRelaxed, Dictionary } from '@ton/core';

import { Op } from './JettonConstants';

export type JettonMasterContent = {
    type: 0 | 1,
    uri: string
};

export type JettonMasterConfig = { admin: Address; content: Cell; walletCode: Cell };

export function jettonMasterConfigToCell(config: JettonMasterConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeRef(config.content)
        .storeRef(config.walletCode)
        .endCell();
}

export function jettonContentToCell(content: JettonMasterContent) {
    return beginCell()
        .storeUint(content.type, 8)
        .storeStringTail(content.uri) //Snake logic under the hood
        .endCell();
}

export class JettonMaster implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromAddress(address: Address) {
        return new JettonMaster(address);
    }

    static createFromConfig(config: JettonMasterConfig, code: Cell, workchain = 0) {
        const data = jettonMasterConfigToCell(config);
        const init = { code, data };
        return new JettonMaster(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    protected static jettonInternalTransfer(jetton_amount: bigint,
        forward_ton_amount: bigint,
        response_addr?: Address,
        query_id: number | bigint = 0) {
        return beginCell()
            .storeUint(Op.internal_transfer, 32)
            .storeUint(query_id, 64)
            .storeCoins(jetton_amount)
            .storeAddress(null)
            .storeAddress(response_addr)
            .storeCoins(forward_ton_amount)
            .storeBit(false)
            .endCell();

    }

    // if (op == op::mint) {
    //     throw_unless(73, equal_slices(sender_address, admin_address)); ;; only admin can mint - Wrapper Contract

    //     slice to_address = in_msg_body~load_msg_addr();
    //     int amount = in_msg_body~load_coins();
    //     cell master_msg = in_msg_body~load_ref(); ;; load a reference message 

    //     slice master_msg_cs = master_msg.begin_parse();
    //     master_msg_cs~skip_bits(32 + 64); ;; op + query_id
    //     int jetton_amount = master_msg_cs~load_coins();

    //     mint_tokens(to_address, jetton_wallet_code, amount, master_msg);
    //     save_data(total_supply + jetton_amount, admin_address, content, jetton_wallet_code);
    //     return ();
    // }
    static mintMessage(from: Address, to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint, query_id: number | bigint = 0) {
        const mintMsg = beginCell().storeUint(Op.internal_transfer, 32)
            .storeUint(0, 64)
            .storeCoins(jetton_amount)
            .storeAddress(null)
            .storeAddress(from) // Response addr
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(null)
            .endCell();

        return beginCell().storeUint(Op.mint, 32).storeUint(query_id, 64) // op, queryId
            .storeAddress(to)
            .storeCoins(total_ton_amount)
            .storeCoins(jetton_amount)
            .storeRef(mintMsg)
            .endCell();
    }
    async sendMint(provider: ContractProvider, via: Sender, to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint) {
        if (total_ton_amount <= forward_ton_amount) {
            throw new Error("Total ton amount should be > forward amount");
        }
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMaster.mintMessage(this.address, to, jetton_amount, forward_ton_amount, total_ton_amount),
            value: total_ton_amount + toNano('0.015'),
        });
    }

    // if (op == op::batch_mint) {
    //     throw_unless(73, equal_slices(sender_address, admin_address)); ;; 只有管理员可以批量 mint

    //     cell batch_data = in_msg_body~load_ref();
    //     int mint_count = in_msg_body~load_uint(16);

    //     int i = 0;
    //     while (i < mint_count) {
    //         slice batch_slice = batch_data.begin_parse();

    //         while (~ batch_slice.slice_empty?()) {
    //             slice to_address = batch_slice~load_msg_addr();
    //             int amount = batch_slice~load_coins();
    //             cell master_msg = batch_slice~load_ref();

    //             slice master_msg_cs = master_msg.begin_parse();
    //             master_msg_cs~skip_bits(32 + 64); ;; op + query_id
    //             int jetton_amount = master_msg_cs~load_coins();

    //             mint_tokens(to_address, jetton_wallet_code, amount, master_msg);
    //             total_supply += jetton_amount;

    //             i += 1;
    //             if (i >= mint_count) {
    //                 break;
    //             }
    //         }

    //         if (batch_slice.slice_refs_empty?()) {
    //             break;
    //         }
    //         batch_data = batch_slice~load_ref();
    //     }

    //     save_data(total_supply, admin_address, content, jetton_wallet_code);
    //     return ();
    // }

    static mintBatchMessage(
        batch_data: Dictionary<Address, bigint>,
        query_id: number | bigint = 0
    ) {
        return beginCell().storeUint(Op.mint_batch, 32).storeUint(query_id, 64) // op, queryId
            .storeDict(batch_data, Dictionary.Keys.Address(), Dictionary.Values.BigInt(257))
            .storeUint(batch_data.size, 16)
            .endCell();
    }

    async sendMintBatch(
        provider: ContractProvider,
        via: Sender,
        batch_data: Dictionary<Address, bigint>
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMaster.mintBatchMessage(batch_data),
            value: toNano('0.015') * BigInt(batch_data.size),
        });
    }


    /* provide_wallet_address#e450e86a query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
    */
    static discoveryMessage(owner: Address, include_address: boolean) {
        return beginCell().storeUint(Op.provide_wallet_address, 32).storeUint(0, 64) // op, queryId
            .storeAddress(owner).storeBit(include_address)
            .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean, value: bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMaster.discoveryMessage(owner, include_address),
            value: value,
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(Op.change_admin, 32).storeUint(0, 64) // op, queryId
            .storeAddress(newOwner)
            .endCell();
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMaster.changeAdminMessage(newOwner),
            value: toNano("0.05"),
        });
    }
    static changeContentMessage(content: Cell) {
        return beginCell().storeUint(Op.change_content, 32).storeUint(0, 64) // op, queryId
            .storeRef(content)
            .endCell();
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMaster.changeContentMessage(content),
            value: toNano("0.05"),
        });
    }
    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }])
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode
        };
    }

    async getTotalSupply(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.totalSupply;
    }
    async getAdminAddress(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.adminAddress;
    }
    async getContent(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.content;
    }
}