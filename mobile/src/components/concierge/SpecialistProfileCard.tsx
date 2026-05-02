/**
 * SpecialistProfileCard — Concierge master spec section 5.3
 *
 * Renders inline in the visit detail view once the specialist is
 * assigned (visit.fe_id != null). The card is the visible payload of
 * N2 ("Vikram is your Owmee Specialist") — tapping the notification
 * deep-links to the visit detail with this card already on-screen.
 *
 * Pilot: rating defaults to 4.8 server-side until Phase 5's NPS table
 * exists. Photo URL is null for now (no avatar pipeline yet); we render
 * a brand-coloured initials puck instead.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { FEVisits, type SpecialistProfile } from '../../services/api';
import { C, R, S, Shadow } from '../../utils/tokens';

interface Props {
  visitId: string;
  /** Optional override — caller already has the data (saves a round-trip). */
  initial?: SpecialistProfile | null;
  /** Tap target for "See profile" — caller decides what to show. */
  onSeeProfile?: () => void;
}

export default function SpecialistProfileCard({
  visitId,
  initial = null,
  onSeeProfile,
}: Props) {
  const [profile, setProfile] = useState<SpecialistProfile | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    setLoading(true);
    FEVisits.specialistProfile(visitId)
      .then((res) => {
        if (cancelled) return;
        setProfile(res.data);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visitId, initial]);

  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator color={C.petrol} />
      </View>
    );
  }

  if (errored || !profile) {
    return (
      <View style={s.card}>
        <Text style={s.matchingTitle}>Matching specialist</Text>
        <Text style={s.matchingBody}>
          We're matching you with an Owmee Specialist. You'll get a
          notification once confirmed.
        </Text>
      </View>
    );
  }

  const initials = (profile.name || 'O')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{profile.name}</Text>
          <Text style={s.metaLine}>
            {profile.rating_avg.toFixed(1)}★ · {profile.visit_count_total}{' '}
            {profile.visit_count_total === 1 ? 'visit' : 'visits'}
          </Text>
          <Text style={s.metaLine}>Joined {profile.joined_year}</Text>
        </View>
      </View>

      <View style={s.badges}>
        {profile.verified ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>✓ Verified by Owmee</Text>
          </View>
        ) : null}
        {profile.background_checked ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>✓ Background-checked</Text>
          </View>
        ) : null}
      </View>

      {onSeeProfile ? (
        <TouchableOpacity
          onPress={onSeeProfile}
          style={s.seeBtn}
          activeOpacity={0.7}
        >
          <Text style={s.seeText}>See profile →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    ...Shadow.glow,
    gap: S.sm,
  },
  matchingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  matchingBody: {
    fontSize: 13,
    color: C.text2,
    marginTop: 4,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.petrolLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: C.petrolDeep,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  metaLine: {
    fontSize: 13,
    color: C.text2,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: S.sm,
  },
  badge: {
    backgroundColor: C.petrolLight,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    color: C.petrolDeep,
    fontWeight: '600',
  },
  seeBtn: {
    marginTop: S.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  seeText: {
    fontSize: 13,
    color: C.petrol,
    fontWeight: '600',
  },
});
