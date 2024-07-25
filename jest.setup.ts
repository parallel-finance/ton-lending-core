import { fromNano, Transaction } from '@ton/core';

declare global {
    interface BigInt {
        toJSON(): string;
    }
}

BigInt.prototype.toJSON = function () {
    return this.toString();
};

export const sumTransactionsFee = (transactions: Transaction[]) =>
    transactions.reduce((acc, tx) => acc + Number(fromNano(tx.totalFees.coins)), 0);
