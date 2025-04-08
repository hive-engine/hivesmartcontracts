Aggroed: Mancer is suggesting that one of the first projects is that you code up a way to allow tokens other than Bee/BEED to have this relationship where you burn $1 of the variable price coin to get 1 stable coin meant to stay at $1.

I should be able to make a PAL-D coin, and after I have created it then I can add the smart contract relationshiop between PAl and PAL-D such that when I burn $1 of PAL I received 1 PAL-D token. 


HBD, USDT, DAI, and USDC are all options that shoudl be stable


cryptomancer — 3/27/2025 7:48 PM
I’d say the XXXXD version (or whatever it’s named) should be created by the new smart contract and only be allowed to be issued by that contract, in the same manner as BEED.  The token creator should not be allowed to issue it directly.
Certain validations should be in place for the token name, like you can’t create anything that starts with SWAP. As that’s reserved for official Engine tokens, and it has to obey the max token length, and it can’t already exist, etc.
Basically all the same validations that the tokens contract itself has.




Drewlongshot — 3/28/2025 1:17 PM
Jesse wants the token contract owner to have an editable efficiency conversion off XXX to XXX-D 
the editing of that efficiency conversion is 100 BEED the only person thayt can change this is the token contract owner 

for general use though, Aggi wants a 1 BD burn fee for the general use of this smart contract (the conversion piece) 


aggroed — 3/29/2025 11:15 AM
Splinterlands uses 2.5%.  So, if I burn $100 of SPS I actually get $97.5 worth of DEC.

Some groups may want that higher or lower
cryptomancer — 3/29/2025 9:09 PM
Oh I see, you’re talking about the conversion fee.  Yeah, makes sense for that to be configurable.


Drewlongshot — 3/19/2025 5:06 PM
user my or my not have done this (seperate step fro Urq contract) 
Step 3. User must create a LP between token A & B (both of which they created) must be > $1k ($500 of A + $500 of B) 
Step 4. User must create LP of token A or B with Stable coin list provided by Jesse must be > $1k ($500 of A + or $500 of B with the offset of $500 of stable) 
we check for 800 but we tell them 1000