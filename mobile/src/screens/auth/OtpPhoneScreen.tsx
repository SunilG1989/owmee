import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R } from '../../utils/tokens';
import { Auth } from '../../services/api';

export default function OtpPhoneScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    const clean = phone.replace(/\D/g, '');
    if (clean.length !== 10) { Alert.alert('Invalid', 'Enter a 10-digit number'); return; }
    setLoading(true);
    try { await Auth.requestOtp(`+91${clean}`); navigation.navigate('OtpVerify', { phone: `+91${clean}` }); }
    catch (e: any) { Alert.alert('Error', e.response?.data?.detail || 'Failed'); }
    finally { setLoading(false); }
  };
  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={()=>navigation.goBack()} style={{padding:16}}><Text style={{fontSize:20,color:C.text2}}>←</Text></TouchableOpacity>
      <View style={s.body}>
        <Text style={s.title}>Enter your mobile number</Text>
        <Text style={s.sub}>We'll send a 6-digit OTP to verify</Text>
        <View style={s.row}>
          <View style={s.flag}><Text style={{fontSize:14}}>🇮🇳</Text><Text style={{fontSize:14,color:C.text}}>+91</Text></View>
          <TextInput style={s.input} placeholder="98XXXXXXXX" placeholderTextColor={C.text4} keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={setPhone} autoFocus />
        </View>
        <TouchableOpacity style={[s.btn,phone.replace(/\D/g,'').length!==10&&{opacity:0.4}]} disabled={phone.replace(/\D/g,'').length!==10||loading} onPress={submit}>
          {loading?<ActivityIndicator color="#fff"/>:<Text style={s.btnText}>Send OTP</Text>}
        </TouchableOpacity>
        <Text style={s.terms}>By continuing, you agree to our{' '}
          <Text style={s.termsLink}>Terms of Service</Text> and{' '}
          <Text style={s.termsLink}>Privacy Policy</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.cream},body:{flex:1,paddingHorizontal:24,paddingTop:40},title:{fontSize:22,fontWeight:'700',color:C.text,marginBottom:4},sub:{fontSize:13,color:C.text3,marginBottom:32},row:{flexDirection:'row',gap:8,marginBottom:24},flag:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:C.surface,borderRadius:R.sm,paddingHorizontal:12,paddingVertical:12,borderWidth:0.5,borderColor:C.border},input:{flex:1,backgroundColor:C.surface,borderRadius:R.sm,paddingHorizontal:12,paddingVertical:12,fontSize:18,letterSpacing:2,color:C.text,borderWidth:0.5,borderColor:C.border},btn:{backgroundColor:C.honey,borderRadius:R.sm,paddingVertical:14,alignItems:'center'},btnText:{fontSize:14,color:'#fff',fontWeight:'600'},terms:{fontSize:11,color:C.text4,textAlign:'center',marginTop:16,lineHeight:16},termsLink:{color:C.honey,fontWeight:'500'}});
