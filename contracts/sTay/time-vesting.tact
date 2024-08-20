import "../jetton/messages";
struct Lock {
    amount: Int as coins;
    releaseTime: Int as uint32;
}
struct TimeVestingData {
    master: Address;
    owner: Address;
    index: Int as uint16;
    bouncedAmount: Int as coins;
    locks: map<Int as uint16, Lock>;
}
message AddLock {
    user: Address;
    amount: Int as coins;
    releaseTime: Int as uint32;
}
message Claim {
    lockIds: map<Int as uint16, Bool>;
    bouncedAmount: Int as coins;
}
message LockClaimed {
    amount: Int as coins;
    user: Address;
}

contract TimeVesting {
    const MIN_TONS_FOR_STORAGE: Int = ton("0.01");
    const GAS_CONSUMPTION: Int = ton("0.01");
    const TOKEN_TRANSFER_GAS_CONSUMPTION: Int = ton("0.05");
    master: Address;
    owner: Address;
    index: Int as uint16 = 0;
    locks: map<Int as uint16, Lock>;
    bouncedAmount: Int as coins = 0;
    init(master: Address, owner: Address){
        self.owner = owner;
        self.master = master;
    }

    // ====== Received Messages ====== //
    receive(msg: AddLock){
        self.addLock(msg);
    }

    receive(msg: Claim){
        self.claim(msg);
    }

    bounced(src: bounced<LockClaimed>){
        self.bouncedAmount += src.amount;
    }

    // ====== Internal Methods ====== //
    fun addLock(msg: AddLock) {
        require(sender() == self.master, "Not from master");
        
        let ctx: Context = context();
        self.locks.set(self.index, Lock{amount: msg.amount, releaseTime: msg.releaseTime});
        self.index += 1;
        let msgValue: Int = self.remainingValue(ctx.value, self.GAS_CONSUMPTION);
        let fwdFee: Int = ctx.readForwardFee();

        if (msgValue > fwdFee) {
            send(SendParameters{
                    to: self.owner,
                    value: msgValue - fwdFee,
                    bounce: false,
                    mode: SendPayGasSeparately,
                    body: "cashback for vesting".asComment()
                }
            );
        }
    }

    // Notice: max claim size: 5
    // the computationAndActionFee of claim 5 lock is about 0.01
    fun claim(msg: Claim) {
        let ctx: Context = context();
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE;
        let fwdFee: Int = ctx.readForwardFee();
        let computationAndActionFee: Int = self.GAS_CONSUMPTION + self.TOKEN_TRANSFER_GAS_CONSUMPTION;
        let totalFee: Int = (storageFee + fwdFee) + computationAndActionFee;
        require(ctx.value >= totalFee, "Insufficient fee");

        let nowTimestamp: Int = now();
        let amount: Int = 0;
        let bouncedAmount: Int = min(self.bouncedAmount, msg.bouncedAmount);
        self.bouncedAmount -= bouncedAmount;
        amount += bouncedAmount;
        
        foreach (lockId, _ in msg.lockIds) {
            let lock: Lock? = self.locks.get(lockId);
            if (lock != null && lock!!.releaseTime <= nowTimestamp) {
                amount += lock!!.amount;
                self.locks.del(lockId);
            }
        }

        let remainingValue: Int = self.remainingValue(ctx.value, fwdFee + self.GAS_CONSUMPTION);
        send(SendParameters{
                to: self.master,
                value: remainingValue,
                bounce: true,
                mode: SendPayGasSeparately,
                body: LockClaimed{user: self.owner, amount: amount}.toCell()
            }
        );
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.MIN_TONS_FOR_STORAGE - min(tonBalanceBeforeMsg, self.MIN_TONS_FOR_STORAGE);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }
    // ====== Get Methods ====== //

    get fun timeVestingData(): TimeVestingData {
        return
            TimeVestingData{
                owner: self.owner,
                master: self.master,
                index: self.index,
                bouncedAmount: self.bouncedAmount,
                locks: self.locks
            };
    }
}