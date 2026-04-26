import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, useWindowDimensions, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';
import { useLocation } from '../../hooks/useLocation';

const kidsStyles = StyleSheet.create({ colWrap: { gap: 8, paddingHorizontal: 16 } });

export default function KidsSectionScreen({ navigation }: any) {
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const { location } = useLocation();
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{(async()=>{try{const r=await Listings.browse({kids_only:true,lat:location?.lat,lng:location?.lng,limit:30});setItems(r.data.listings||[]);}catch{}finally{setLoading(false);}})();},[location]);

  return (<SafeAreaView style={{flex:1,backgroundColor:'#FFF7ED'}} edges={['top']}>
    <View style={{paddingHorizontal:16,paddingTop:8,paddingBottom:12}}>
      <Text style={{fontSize:22,fontWeight:'700',color:C.text}}>🧸 Kids items</Text>
      <Text style={{fontSize:12,color:C.text3,marginTop:2}}>Verified sellers · Hygiene rated</Text>
    </View>
    {loading?<ActivityIndicator color={C.honey} style={{marginTop:40}}/>:
      <FlatList data={items} keyExtractor={i=>i.id} numColumns={2} columnWrapperStyle={kidsStyles.colWrap} contentContainerStyle={{paddingBottom:100}}
        renderItem={({item})=><ListingCard listing={item} onPress={l=>navigation.navigate('ListingDetail',{listingId:l.id})} showDistance={!!location} cardWidth={cardWidth}/>}
        ListEmptyComponent={<View style={{alignItems:'center',paddingTop:60}}><Text style={{fontSize:40,marginBottom:12}}>🧸</Text><Text style={{fontSize:14,color:C.text3}}>No kids items yet</Text></View>} removeClippedSubviews maxToRenderPerBatch={6} windowSize={5}/>}
  </SafeAreaView>);
}
