/**
 * KycFlowScreen
 * 4-step KYC: Aadhaar OTP → PAN → Liveness → Payout account
 *
 * India UX:
 * - "One-time · 3 minutes" framing upfront
 * - Progress saved — can resume from any step
 * - Clear next action at every step
 * - Privacy note: "Your data is encrypted and never shared"
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { Kyc, Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import type { AppStackParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<AppStackParams>;

type KycStep = 'aadhaar_initiate' | 'aadhaar_verify' | 'pan' | 'liveness' | 'payout' | 'done';

interface StepStatus { done: boolean; active: boolean; label: string; sublabel: string; }

function getSteps(currentStep: KycStep, kycStatus?: string): StepStatus[] {
  const isDone = (step: KycStep) => {
    const order: KycStep[] = ['aadhaar_initiate','aadhaar_verify','pan','liveness','payout','done'];
    return order.indexOf(currentStep) > order.indexOf(step);
  };
  return [
    { done: true, active: false, label: 'Mobile verified', sublabel: 'Phone number confirmed' },
    { done: isDone('aadhaar_verify'), active: currentStep === 'aadhaar_initiate' || currentStep === 'aadhaar_verify', label: 'Aadhaar OTP', sublabel: isDone('aadhaar_verify') ? 'Identity confirmed' : 'Tap to continue →' },
    { done: isDone('pan'), active: currentStep === 'pan', label: 'PAN verification', sublabel: isDone('pan') ? 'PAN verified' : currentStep === 'pan' ? 'Tap to continue →' : 'Waiting' },
    { done: isDone('liveness'), active: currentStep === 'liveness', label: 'Quick selfie', sublabel: isDone('liveness') ? 'Liveness confirmed' : 'Liveness check · 30 sec' },
    { done: currentStep === 'done', active: currentStep === 'payout', label: 'Payment account', sublabel: currentStep === 'done' ? 'Account verified' : 'UPI or bank account' },
  ];
}

export default function KycFlowScreen() {
  const navigation = useNavigation<Nav>();
  const { updateTier } = useAuthStore();

  const [step, setStep] = useState<KycStep>('aadhaar_initiate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Aadhaar
  const [aadhaarReqId, setAadhaarReqId] = useState('');
  const [aadhaarOtp, setAadhaarOtp] = useState('');
  // PAN
  const [pan, setPan] = useState('');
  // Payout
  const [payoutType, setPayoutType] = useState<'upi' | 'bank'>('upi');
  const [payoutValue, setPayoutValue] = useState('');

  // Check if already partially done
  useEffect(() => {
    Kyc.status().then(res => {
      const s = res.data.steps;
      if (s.payout_account) setStep('done');
      else if (s.liveness) setStep('payout');
      else if (s.pan) setStep('liveness');
      else if (s.aadhaar) setStep('pan');
    }).catch(() => {});
  }, []);

  const handleAadhaarInitiate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      await Kyc.consent('aadhaar_kyc');
      const res = await Kyc.aadhaarInitiate();
      setAadhaarReqId(res.data.request_id);
      setStep('aadhaar_verify');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const handleAadhaarVerify = useCallback(async () => {
    if (aadhaarOtp.length !== 6) return;
    setLoading(true); setError(null);
    try {
      await Kyc.aadhaarVerify(aadhaarReqId, aadhaarOtp);
      setStep('pan');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [aadhaarReqId, aadhaarOtp]);

  const handlePan = useCallback(async () => {
    if (pan.length < 10) { setError('Enter a valid 10-character PAN'); return; }
    setLoading(true); setError(null);
    try {
      await Kyc.panVerify(pan.toUpperCase());
      setStep('liveness');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [pan]);

  const handleLiveness = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const sess = await Kyc.livenessSession();
      await Kyc.livenessVerify(sess.data.session_id);
      setStep('payout');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const handlePayout = useCallback(async () => {
    if (!payoutValue.trim()) { setError('Enter your UPI ID or account number'); return; }
    setLoading(true); setError(null);
    try {
      await Kyc.payoutVerify(payoutType, payoutValue.trim());
      // Re-fetch tier
      const me = await Auth.me();
      updateTier(me.data.tier, me.data.kyc_status);
      setStep('done');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [payoutType, payoutValue, updateTier]);

  const steps = getSteps(step);

  if (step === 'done') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.doneContainer}>
          <Text style={s.doneIcon}>✓</Text>
          <Text style={s.doneTitle}>You're verified!</Text>
          <Text style={s.doneSub}>You can now buy and sell on Owmee.</Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={s.doneBtnText}>Start exploring →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
            <Text style={s.backText}>✕</Text>
          </TouchableOpacity>

          {/* Hero */}
          <View style={s.hero}>
            <Text style={s.heroIcon}>🔐</Text>
            <Text style={s.heroTitle}>One-time · 3 minutes</Text>
            <Text style={s.heroSub}>Protects you and the other person.{'\n'}Required once, never again.</Text>
          </View>

          {/* Steps progress */}
          <View style={s.stepsContainer}>
            {steps.map((st, i) => (
              <View key={i} style={[s.stepRow, st.done && s.stepDone, st.active && s.stepActive]}>
                <View style={[s.stepNum, st.done && s.stepNumDone, st.active && s.stepNumActive]}>
                  <Text style={[s.stepNumText, st.done && s.stepNumTextDone, st.active && s.stepNumTextActive]}>
                    {st.done ? '✓' : `${i + 1}`}
                  </Text>
                </View>
                <View style={s.stepInfo}>
                  <Text style={[s.stepLabel, st.done && s.stepLabelDone, st.active && s.stepLabelActive]}>
                    {st.label}
                  </Text>
                  <Text style={[s.stepSub, st.active && s.stepSubActive]}>{st.sublabel}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Step input */}
          <View style={s.inputArea}>
            {error && <Text style={s.errorText}>{error}</Text>}

            {step === 'aadhaar_initiate' && (
              <TouchableOpacity style={s.primaryBtn} onPress={handleAadhaarInitiate} disabled={loading}>
                {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Send Aadhaar OTP →</Text>}
              </TouchableOpacity>
            )}

            {step === 'aadhaar_verify' && (
              <>
                <Text style={s.inputLabel}>Enter the OTP sent to your Aadhaar-linked mobile</Text>
                <TextInput
                  style={s.input}
                  value={aadhaarOtp}
                  onChangeText={t => { setAadhaarOtp(t.replace(/\D/g,'').slice(0,6)); setError(null); }}
                  keyboardType="number-pad"
                  placeholder="6-digit OTP"
                  placeholderTextColor={Colors.text4}
                  maxLength={6}
                  autoFocus
                />
                <TouchableOpacity style={[s.primaryBtn, aadhaarOtp.length < 6 && s.btnDisabled]} onPress={handleAadhaarVerify} disabled={loading || aadhaarOtp.length < 6}>
                  {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Verify OTP →</Text>}
                </TouchableOpacity>
              </>
            )}

            {step === 'pan' && (
              <>
                <Text style={s.inputLabel}>Enter your PAN number</Text>
                <TextInput
                  style={s.input}
                  value={pan}
                  onChangeText={t => { setPan(t.toUpperCase().slice(0,10)); setError(null); }}
                  placeholder="ABCDE1234F"
                  placeholderTextColor={Colors.text4}
                  autoCapitalize="characters"
                  maxLength={10}
                  autoFocus
                />
                <TouchableOpacity style={[s.primaryBtn, pan.length < 10 && s.btnDisabled]} onPress={handlePan} disabled={loading || pan.length < 10}>
                  {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Verify PAN →</Text>}
                </TouchableOpacity>
              </>
            )}

            {step === 'liveness' && (
              <>
                <Text style={s.inputLabel}>Quick selfie to confirm it's you — takes 30 seconds</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={handleLiveness} disabled={loading}>
                  {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Take selfie →</Text>}
                </TouchableOpacity>
              </>
            )}

            {step === 'payout' && (
              <>
                <Text style={s.inputLabel}>Add your payout account to receive payments</Text>
                <View style={s.payoutToggle}>
                  {(['upi','bank'] as const).map(t => (
                    <TouchableOpacity key={t} style={[s.toggleBtn, payoutType === t && s.toggleBtnActive]} onPress={() => setPayoutType(t)}>
                      <Text style={[s.toggleText, payoutType === t && s.toggleTextActive]}>{t === 'upi' ? 'UPI ID' : 'Bank account'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={s.input}
                  value={payoutValue}
                  onChangeText={t => { setPayoutValue(t); setError(null); }}
                  placeholder={payoutType === 'upi' ? 'yourname@upi' : 'Account number'}
                  placeholderTextColor={Colors.text4}
                  autoCapitalize="none"
                  keyboardType={payoutType === 'upi' ? 'email-address' : 'number-pad'}
                  autoFocus
                />
                <TouchableOpacity style={[s.primaryBtn, !payoutValue.trim() && s.btnDisabled]} onPress={handlePayout} disabled={loading || !payoutValue.trim()}>
                  {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={s.primaryBtnText}>Verify account →</Text>}
                </TouchableOpacity>
              </>
            )}

            <Text style={s.privacy}>🔒 Your data is encrypted and never shared</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  scroll: { paddingBottom: 40 },
  back: { padding: Spacing.lg, paddingBottom: 0, alignSelf: 'flex-end' },
  backText: { fontSize: 18, color: Colors.text3 },
  hero: { backgroundColor: Colors.tealLight, margin: Spacing.lg, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center' },
  heroIcon: { fontSize: 32, marginBottom: Spacing.sm },
  heroTitle: { fontSize: 15, fontWeight: '500', color: Colors.tealText, marginBottom: 4, textAlign: 'center' },
  heroSub: { fontSize: 12, color: Colors.teal, textAlign: 'center', lineHeight: 18 },
  stepsContainer: { paddingHorizontal: Spacing.lg, gap: 8, marginBottom: Spacing.xl },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 0.5, borderColor: Colors.border },
  stepDone: { backgroundColor: Colors.tealLight, borderColor: Colors.tealLight },
  stepActive: { borderColor: Colors.teal, borderWidth: 1.5 },
  stepNum: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepNumDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  stepNumActive: { borderColor: Colors.teal },
  stepNumText: { fontSize: 11, fontWeight: '600', color: Colors.text4 },
  stepNumTextDone: { color: Colors.white },
  stepNumTextActive: { color: Colors.teal },
  stepInfo: { flex: 1 },
  stepLabel: { fontSize: 12, fontWeight: '500', color: Colors.text2 },
  stepLabelDone: { color: Colors.tealText },
  stepLabelActive: { color: Colors.text },
  stepSub: { fontSize: 10, color: Colors.text4, marginTop: 1 },
  stepSubActive: { color: Colors.teal },
  inputArea: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  inputLabel: { fontSize: 13, color: Colors.text2, lineHeight: 19 },
  input: { backgroundColor: Colors.border2, borderRadius: Radius.md, padding: 14, fontSize: 15, color: Colors.text, borderWidth: 0.5, borderColor: Colors.border },
  primaryBtn: { backgroundColor: Colors.teal, borderRadius: Radius.md, padding: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 14, fontWeight: '500', color: Colors.white },
  payoutToggle: { flexDirection: 'row', gap: 8 },
  toggleBtn: { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  toggleText: { fontSize: 13, color: Colors.text3 },
  toggleTextActive: { color: Colors.teal, fontWeight: '500' },
  errorText: { fontSize: 12, color: Colors.error },
  privacy: { fontSize: 11, color: Colors.text4, textAlign: 'center', marginTop: Spacing.sm },
  doneContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.md },
  doneIcon: { fontSize: 56, color: Colors.teal },
  doneTitle: { fontSize: 22, fontWeight: '500', color: Colors.text, letterSpacing: -0.4 },
  doneSub: { fontSize: 14, color: Colors.text3, textAlign: 'center' },
  doneBtn: { marginTop: Spacing.xl, backgroundColor: Colors.teal, borderRadius: Radius.full, paddingHorizontal: 28, paddingVertical: 14 },
  doneBtnText: { fontSize: 15, fontWeight: '500', color: Colors.white },
});
