import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { ApiError, api } from "../../../api/client";
import type { CompanyFull } from "../../../api/types";
import { useData } from "../../../api/useData";
import { useDesk } from "../../../lib/desk";
import { useSession } from "../../../lib/session";
import { C, F, S, short, usd } from "../../../theme";
import { Backdrop } from "../../../ui/Backdrop";
import { CompanyPill } from "../../../ui/CompanyPicker";
import { Frame } from "../../../ui/Frame";
import { Body, Button, Caps, Dim, Header, Mono, Problem, Title } from "../../../ui/kit";

/**
 * Money out happens in the app only in builds made with EXPO_PUBLIC_MONEY_OUT=app. The Play build
 * leaves withdrawing and stopping to the website (Google Play treats moving funds out of a held
 * wallet as a licensed wallet feature); the app shows what is there and deletes a stopped company.
 */
const MONEY_OUT_IN_APP = process.env.EXPO_PUBLIC_MONEY_OUT === "app";

/**
 * Money out and the end of a company. Each step asks for the fingerprint and then the wallet's
 * signature: a stolen, unlocked phone cannot move a company's money on its own.
 */
export default function Lifecycle() {
  const { focus, refresh, setFocus, desk } = useDesk();
  const { withStep, toast, address } = useSession();
  const co = useData<CompanyFull>(focus ? `co:${focus.id}` : null, () => api.company(focus!.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  if (!focus) return <View style={{ flex: 1 }}><Backdrop /><Header title="Stop and funds" /></View>;

  const bio = async (why: string) => (await LocalAuthentication.authenticateAsync({ promptMessage: why, cancelLabel: "Cancel" })).success;
  const run = async (key: string, why: string, f: () => Promise<string>) => {
    setErr(null);
    if (!(await bio(why))) return;
    setBusy(key);
    try { toast(await f()); await Promise.all([co.refresh(), refresh()]); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(null); }
  };
  const w = co.data?.withdrawableUsd ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <Header title="Stop and funds" right={<CompanyPill />} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {err && <Problem text={err} />}
        {!MONEY_OUT_IN_APP && (
          <Step title="Take revenue out, or stop it" body={`Withdrawing revenue and stopping a company (its funds go back to your wallet ${short(address)}) happen on the website: open your owner desk at getnightshift.tech on a computer or in the browser, signed in with this wallet.`}>
            <Mono style={{ color: C.ink }}>Ready to withdraw: <Mono style={{ color: C.lime, fontFamily: F.monoBold }}>{usd(w)}</Mono></Mono>
            <Dim style={{ marginTop: 8, fontSize: 13 }}>Here you can pause it (Live tab), change its limits, and delete it once it is stopped.</Dim>
          </Step>
        )}
        {MONEY_OUT_IN_APP && <>
        <Step title="Take revenue out" body={`Sends the company's USDC revenue to your wallet ${short(address)}. Its IMD stays, so it keeps working.`}>
          <Mono style={{ marginBottom: 12, color: C.ink }}>Ready to withdraw: <Mono style={{ color: C.lime, fontFamily: F.monoBold }}>{usd(w)}</Mono></Mono>
          <Button kind="lime" icon="fingerprint" disabled={w < 0.01 || !!busy} busy={busy === "withdraw"} onPress={() => run("withdraw", `Withdraw ${usd(w)}`, async () => {
            const r = await withStep({ action: "withdraw", companyId: focus.id }, (p) => api.withdraw(focus.id, p));
            return `Sent ${usd(r.sentUsd)} to your wallet${r.feeUsd ? ` (fee ${usd(r.feeUsd)})` : ""}.`;
          })}>{w >= 0.01 ? `Withdraw ${usd(w)}` : "Nothing to withdraw yet"}</Button>
        </Step>

        <Step title="Stop and take the funds back" body="Ends its shifts and sends everything its wallet holds (IMD, USDC and what is left of its ETH) back to your wallet. You can delete it afterwards, or resume it later.">
          <Button kind="danger" icon="power" disabled={!!busy} busy={busy === "close"} onPress={() => run("close", `Stop ${focus.name}`, async () => {
            await withStep({ action: "close", companyId: focus.id }, (p) => api.close(focus.id, p));
            return `${focus.name} is stopped. Its funds are on their way to your wallet.`;
          })}>Stop {focus.name}</Button>
        </Step>
        </>}

        <Step title="Delete" body="Takes it off your desk and off the market. Products people bought stay downloadable for them. Stop it first so its funds come back to you. You can restore it later from Deleted companies.">
          <Caps style={{ marginBottom: 8 }}>Type its name to confirm</Caps>
          <TextInput value={confirm} onChangeText={setConfirm} placeholder={focus.name} placeholderTextColor={C.ghost} autoCapitalize="none" style={{ fontFamily: F.uiReg, fontSize: 16, color: C.ink, borderWidth: 1, borderColor: C.lineHi, backgroundColor: C.panel, padding: 12, marginBottom: 12 }} />
          <Button kind="dangerSolid" icon="trash" disabled={confirm.trim().toLowerCase() !== focus.name.trim().toLowerCase() || !!busy} busy={busy === "delete"} onPress={() => run("delete", `Delete ${focus.name}`, async () => {
            await withStep({ action: "delete", companyId: focus.id }, (p) => api.remove(focus.id, confirm.trim(), p));
            const next = desk?.companies.find((c) => c.id !== focus.id);
            if (next) setFocus(next.id);
            setTimeout(() => router.navigate("/"), 300);
            return `${focus.name} is deleted.`;
          })}>Delete {focus.name}</Button>
        </Step>
        <Dim style={{ marginTop: 6, fontSize: 13 }}>{MONEY_OUT_IN_APP ? "Each of these asks for your fingerprint, then for your wallet to sign. Nothing here can be done with the phone alone." : "Deleting asks for your fingerprint, then for your wallet to sign."}</Dim>
      </ScrollView>
    </View>
  );
}

function Step({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <Frame tick style={{ marginBottom: 14 }}>
      <Title style={{ fontSize: 18 }}>{title}</Title>
      <Body style={{ color: C.dim, fontSize: 14.5, marginTop: 6, marginBottom: 14 }}>{body}</Body>
      {children}
    </Frame>
  );
}

