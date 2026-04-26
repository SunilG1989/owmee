import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, Alert, ActivityIndicator , Image} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, formatPrice, timeAgo } from '../utils/tokens';
import { Offers, Transactions, type Offer, type Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';

type Tab = 'received' | 'sent' | 'deals';
export default function OffersScreen({ navigation }: any) {
  const { isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<Tab>('received');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [deals, setDeals] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!isAuthenticated) return (<SafeAreaView style={s.safe} edges={['top']}><View style={s.gate}><Text style={{fontSize:48,marginBottom:16}}>✉️</Text><Text style={s.gateH}>Sign in to see deals</Text><TouchableOpacity style={s.gateBtn} onPress={()=>navigation.getParent()?.navigate('AuthFlow')}><Text style={{fontSize:14,color:'#fff',fontWeight:'600'}}>Sign in</Text></TouchableOpacity></View></SafeAreaView>);

  const load = useCallback(async()=>{if(!refreshing)setLoading(true);try{if(tab==='deals'){const r=await Transactions.list();setDeals(r.data.transactions||r.data||[]);}else{const r=tab==='received'?await Offers.received():await Offers.sent();setOffers(r.data.offers||r.data||[]);}}catch{}finally{setLoading(false);setRefreshing(false);}}, [tab,refreshing]);
  useFocusEffect(useCallback(()=>{load();},[tab]));

  const renderOffer=({item}:{item:Offer})=>{const exp=item.expires_at&&new Date(item.expires_at)<new Date();const rem=item.expires_at?Math.max(0,Math.floor((new Date(item.expires_at).getTime()-Date.now())/60000)):null;
    return(<TouchableOpacity style={s.card} onPress={()=>navigation.navigate('ListingDetail',{listingId:item.listing_id})}>
      <View style={s.row}>{item.listing_thumbnail?<Image source={{uri:item.listing_thumbnail}} style={s.thumb} resizeMode={"cover"}/>:<View style={[s.thumb,s.tp]}><Text style={{fontSize:20}}>📦</Text></View>}
        <View style={{flex:1}}><Text style={s.title} numberOfLines={1}>{item.listing_title}</Text><View style={{flexDirection:'row',gap:8,alignItems:'center'}}><Text style={s.amt}>{formatPrice(item.amount)}</Text><Text style={s.lp}>{formatPrice(item.listing_price)}</Text></View>
          {item.note&&<Text style={s.note} numberOfLines={1}>"{item.note}"</Text>}
          <View style={{flexDirection:'row',gap:8,marginTop:4}}><Text style={s.time}>{timeAgo(item.created_at)}</Text>{rem!==null&&!exp&&<Text style={[s.exp,rem<60&&{color:C.red}]}>{rem<60?`${rem}m left`:`${Math.floor(rem/60)}h left`}</Text>}{exp&&<Text style={[s.exp,{color:C.red}]}>Expired</Text>}</View></View></View>
      {tab==='received'&&item.status==='pending'&&!exp&&(<View style={s.acts}><TouchableOpacity style={s.accBtn} onPress={async()=>{try{const r=await Offers.accept(item.id);const txnId=r.data?.transaction_id;load();if(txnId)navigation.navigate('TransactionDetail',{transactionId:txnId});}catch{Alert.alert('Error','Failed');}}}><Text style={{fontSize:13,color:'#fff',fontWeight:'600'}}>Accept</Text></TouchableOpacity><TouchableOpacity style={s.ctrBtn} onPress={()=>{Alert.prompt?Alert.prompt('Counter offer','Enter your price (₹)',(val:string)=>{if(val&&parseFloat(val)>0){Offers.counter(item.id,parseFloat(val)).then(()=>load()).catch(()=>Alert.alert('Error','Failed'));}},undefined,undefined,'number-pad'):Alert.alert('Counter','Counter-offer coming soon')}}><Text style={{fontSize:13,color:C.honey,fontWeight:'600'}}>Counter</Text></TouchableOpacity><TouchableOpacity style={s.rejBtn} onPress={async()=>{try{await Offers.reject(item.id);load();}catch{Alert.alert('Error','Failed');}}}><Text style={{fontSize:13,color:C.text3}}>Decline</Text></TouchableOpacity></View>)}
      {item.status==='accepted'&&<View style={s.stBar}><Text style={s.stText}>✓ Accepted</Text></View>}
    </TouchableOpacity>);};

  const renderDeal=({item}:{item:Transaction})=>(<TouchableOpacity style={s.card} onPress={()=>navigation.navigate('TransactionDetail',{transactionId:item.id})}>
    <View style={s.row}><View style={[s.thumb,s.tp]}><Text style={{fontSize:20}}>🤝</Text></View><View style={{flex:1}}><Text style={s.title} numberOfLines={1}>{item.listing_title||'Deal'}</Text><Text style={s.amt}>{formatPrice(item.amount)}</Text><View style={{flexDirection:'row',alignItems:'center',gap:4,marginTop:4}}><View style={[s.dot,{backgroundColor:item.status==='completed'?C.green:item.status==='cancelled'?C.red:C.honey}]}/><Text style={{fontSize:11,color:C.text3,textTransform:'capitalize'}}>{item.status.replace(/_/g,' ')}</Text></View></View></View></TouchableOpacity>);

  return(<SafeAreaView style={s.safe} edges={['top']}><Text style={s.hdr}>Deals</Text>
    <View style={s.tabs}>{(['received','sent','deals'] as Tab[]).map(t=>(<TouchableOpacity key={t} style={[s.tab,tab===t&&s.tabOn]} onPress={()=>setTab(t)}><Text style={[s.tabT,tab===t&&{color:C.honeyDeep,fontWeight:'600'}]}>{t==='deals'?'In progress':t==='received'?'Received':'Sent'}</Text></TouchableOpacity>))}</View>
    {loading?<ActivityIndicator color={C.honey} style={{marginTop:40}}/>:tab==='deals'?
      <FlatList data={deals} keyExtractor={i=>i.id} renderItem={renderDeal} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();}} tintColor={C.honey}/>} ListEmptyComponent={<View style={s.empty}><Text style={{fontSize:40,marginBottom:12}}>🤝</Text><Text style={s.emptyT}>No deals yet</Text></View>} removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}/>:
      <FlatList data={offers} keyExtractor={i=>i.id} renderItem={renderOffer} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();}} tintColor={C.honey}/>} ListEmptyComponent={<View style={s.empty}><Text style={{fontSize:40,marginBottom:12}}>✉️</Text><Text style={s.emptyT}>{tab==='received'?'No offers received':'No offers sent'}</Text></View>} removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}/>}
  </SafeAreaView>);
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.cream},hdr:{fontSize:22,fontWeight:'700',color:C.text,paddingHorizontal:16,paddingTop:8},tabs:{flexDirection:'row',paddingHorizontal:16,marginTop:12,gap:4},tab:{paddingHorizontal:14,paddingVertical:8,borderRadius:R.pill,backgroundColor:C.surface,borderWidth:1,borderColor:C.border},tabOn:{backgroundColor:C.honeyLight,borderColor:C.honey},tabT:{fontSize:12,color:C.text3},list:{padding:16},card:{backgroundColor:C.surface,borderRadius:R.lg,marginBottom:10,padding:12,borderWidth:1,borderColor:C.border},row:{flexDirection:'row',gap:12},thumb:{width:60,height:60,borderRadius:R.sm},tp:{backgroundColor:C.sand,alignItems:'center',justifyContent:'center'},title:{fontSize:14,fontWeight:'600',color:C.text,marginBottom:2},amt:{fontSize:16,fontWeight:'700',color:C.honey},lp:{fontSize:12,color:C.text4,textDecorationLine:'line-through'},note:{fontSize:11,color:C.text3,fontStyle:'italic',marginTop:2},time:{fontSize:10,color:C.text4},exp:{fontSize:10,color:C.honey,fontWeight:'600'},acts:{flexDirection:'row',gap:8,marginTop:10,borderTopWidth:0.5,borderTopColor:C.border,paddingTop:10},accBtn:{flex:1,backgroundColor:C.honey,borderRadius:R.sm,paddingVertical:8,alignItems:'center'},ctrBtn:{flex:1,borderRadius:R.sm,paddingVertical:8,alignItems:'center',borderWidth:1,borderColor:C.honey},rejBtn:{flex:1,borderRadius:R.sm,paddingVertical:8,alignItems:'center',borderWidth:0.5,borderColor:C.border},stBar:{marginTop:8,backgroundColor:C.forestLight,borderRadius:6,paddingVertical:6,paddingHorizontal:10},stText:{fontSize:11,color:C.forest,fontWeight:'600'},dot:{width:6,height:6,borderRadius:3},empty:{alignItems:'center',paddingTop:60},emptyT:{fontSize:14,color:C.text3},gate:{flex:1,alignItems:'center',justifyContent:'center',padding:40},gateH:{fontSize:18,fontWeight:'600',color:C.text,marginBottom:16},gateBtn:{backgroundColor:C.honey,borderRadius:R.sm,paddingHorizontal:24,paddingVertical:12}});
