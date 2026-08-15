import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "Wallets" };

const SECTIONS = ["Solana wallet", "Goldcoin wallet"];

export default function WalletsPage() {
  return (
    <ContentPage
      title="Wallets"
      intro="You need a wallet on each network involved in your transfer."
      sections={SECTIONS}
    >
      <ContentSection id="solana-wallet" title="Solana wallet">
        <p>
          Any wallet that supports the Wallet Standard works — this bridge does not
          require a specific one. Connect it from the button in the header. For a Solana →
          Goldcoin transfer, your Solana wallet also signs the on-chain deposit
          instruction directly; this bridge never asks for your private key.
        </p>
      </ContentSection>
      <ContentSection id="goldcoin-wallet" title="Goldcoin wallet">
        <p>
          A Goldcoin address is where a Solana → Goldcoin payout is released to, and where
          a Goldcoin → Solana deposit is sent from. This bridge does not integrate a
          Goldcoin browser wallet — use whatever native Goldcoin wallet you already hold
          GLC in.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
