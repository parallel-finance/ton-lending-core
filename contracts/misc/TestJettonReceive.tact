import "@stdlib/deploy";
import "@stdlib/ownable";
import "../jetton/messages.tact";
message SetOwnedJettonWallet {
    jettonMaster: Address;
    jettonWallet: Address;
}

contract TestJettonReceive with Ownable, Deployable {
    owner: Address;
    ownedJettonWallet: map<Address, Address>;
    init(){
        self.owner = context().sender;
        self.ownedJettonWallet = emptyMap();
    }

    get fun ownedJettonWallet(wallet: Address): Address? {
      return self.ownedJettonWallet.get(wallet);
    }

    fun setOwnedJettonWallet(jettonWallet: Address, jettonMaster: Address) {
        self.requireOwner();
        self.ownedJettonWallet.set(jettonWallet, jettonMaster);
    }

    receive(msg: SetOwnedJettonWallet){
        self.setOwnedJettonWallet(msg.jettonWallet, msg.jettonMaster);
    }

    fun checkTokenNotification(jettonWallet: Address): Address? {
        let jettonMaster: Address? = self.ownedJettonWallet.get(jettonWallet);
        return jettonMaster;
    }

    fun handleUpdate(jettonMaster: Address, from: Address, amount: Int) {

    }

    receive(msg: TokenNotification){
      let jettonMaster: Address? = self.checkTokenNotification(context().sender);
      if (jettonMaster == null) {
        dump("invaild token received")
      } else {
        self.handleUpdate(jettonMaster!!, msg.from, msg.amount);
        dump(jettonMaster!!);
      }
    }
}