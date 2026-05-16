/**
 * EditDetailsSheet — bottom sheet to override AI's category/brand/model/etc.
 *
 * Sprint 8 Phase 2 — uses RN's Modal slide animation as a faux bottom sheet
 * to avoid pulling in @gorhom/bottom-sheet (which would require reanimated v3).
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { C, T, S, R } from '../../../../utils/tokens';
import { Button } from '../../../../components/ui';
import {
  CATEGORY_PICKS,
  COLOR_OPTIONS,
  PROCESSOR_OPTIONS,
  SCREEN_SIZE_OPTIONS,
  canonicalCategorySlug,
  findCatalogOption,
  getBrandsForCategory,
  getCategoryKind,
  getModelSuggestions,
  getRamOptionsForCategory,
  getStorageOptionsForCategory,
} from '../../../../utils/listingCatalog';

type EditableDetails = {
  title?: string;
  brand?: string;
  model?: string;
  storage?: string;
  ram?: string;
  processor?: string;
  screen_size?: string;
  color?: string;
  purchase_year?: number | null;
  accessories?: string;
  warranty_status?: string;
  category_slug?: string;
};

interface Props {
  initial: EditableDetails;
  onSave: (next: EditableDetails) => void;
  onClose: () => void;
}

export default function EditDetailsSheet({ initial, onSave, onClose }: Props) {
  const initialCategory = canonicalCategorySlug(initial.category_slug);
  const [title, setTitle] = useState(initial.title || '');
  const initialBrand = findCatalogOption(initial.brand, getBrandsForCategory(initialCategory)) || (initial.brand || '');
  const [category_slug, setCategorySlug] = useState(initialCategory);
  const [brand, setBrand] = useState(initialBrand);
  const [model, setModel] = useState(
    findCatalogOption(initial.model, getModelSuggestions(initialCategory, initialBrand)) || (initial.model || ''),
  );
  const [storage, setStorage] = useState(
    findCatalogOption(initial.storage, getStorageOptionsForCategory(initialCategory)) || (initial.storage || ''),
  );
  const [ram, setRam] = useState(
    findCatalogOption(initial.ram, getRamOptionsForCategory(initialCategory)) || (initial.ram || ''),
  );
  const [processor, setProcessor] = useState(initial.processor || '');
  const [screenSize, setScreenSize] = useState(initial.screen_size || '');
  const [color, setColor] = useState(initial.color || '');
  const [purchaseYear, setPurchaseYear] = useState(initial.purchase_year ? String(initial.purchase_year) : '');
  const [accessories, setAccessories] = useState(initial.accessories || '');
  const [warrantyStatus, setWarrantyStatus] = useState(initial.warranty_status || '');
  const [moreOpen, setMoreOpen] = useState(false);
  const categoryKind = getCategoryKind(category_slug);
  const isElectronic = categoryKind === 'phone' || categoryKind === 'laptop' || categoryKind === 'tablet';
  const isOther = categoryKind === 'other';
  const brandOptions = useMemo(() => getBrandsForCategory(category_slug), [category_slug]);
  const modelOptions = useMemo(() => getModelSuggestions(category_slug, brand), [category_slug, brand]);
  const storageOptions = useMemo(() => getStorageOptionsForCategory(category_slug), [category_slug]);
  const ramOptions = useMemo(() => getRamOptionsForCategory(category_slug), [category_slug]);
  const ramRequired = categoryKind === 'laptop';
  const requiredMissing = useMemo(() => {
    const missing: string[] = [];
    if (!category_slug) missing.push('category');
    if (isOther && (title.trim().length < 4 || /^used item$/i.test(title.trim()))) missing.push('title');
    if (isElectronic) {
      if (!findCatalogOption(brand, brandOptions)) missing.push('brand');
      if (modelOptions.length > 0 && !findCatalogOption(model, modelOptions)) missing.push('model');
      if (!findCatalogOption(storage, storageOptions)) missing.push('storage');
      if (ramRequired && !findCatalogOption(ram, ramOptions)) missing.push('RAM');
    }
    return missing;
  }, [brand, brandOptions, category_slug, isElectronic, isOther, model, modelOptions, ram, ramOptions, ramRequired, storage, storageOptions, title]);

  const selectCategory = (nextSlug: string) => {
    const next = canonicalCategorySlug(nextSlug);
    if (!next || next === category_slug) return;
    setCategorySlug(next);
    const nextBrand = findCatalogOption(brand, getBrandsForCategory(next));
    setBrand(nextBrand);
    setModel('');
    setStorage(findCatalogOption(storage, getStorageOptionsForCategory(next)));
    setRam(findCatalogOption(ram, getRamOptionsForCategory(next)));
  };

  const selectBrand = (next: string) => {
    if (brand !== next) setModel('');
    setBrand(next);
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={st.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={st.sheet}>
          <View style={st.handle} />
          <Text style={st.title}>Edit details</Text>

          <ScrollView style={st.scroll}>
            <Text style={st.sectionTitle}>Essential</Text>
            <Text style={st.label}>Category</Text>
            <View style={st.chipRow}>
              {CATEGORY_PICKS.map((c) => (
                <TouchableOpacity
                  key={c.slug}
                  onPress={() => selectCategory(c.slug)}
                  style={[st.chip, category_slug === c.slug && st.chipActive]}>
                  <Text style={[st.chipText, category_slug === c.slug && st.chipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {isElectronic ? (
              <>
                <View style={st.confirmBox}>
                  <Text style={st.confirmTitle}>Confirm exact product details</Text>
                  <Text style={st.confirmText}>
                    Choose from the chips so buyers see searchable, consistent specs.
                  </Text>
                </View>

                <OptionChips
                  label="Brand"
                  required
                  options={brandOptions}
                  selected={brand}
                  onSelect={selectBrand}
                />

                <OptionChips
                  label="Model"
                  required={modelOptions.length > 0}
                  options={modelOptions}
                  selected={model}
                  onSelect={setModel}
                  emptyText={brand ? 'Model catalogue is not loaded for this brand yet.' : 'Select brand first.'}
                />

                <Text style={st.label}>Storage</Text>
                <ChipSet options={storageOptions} selected={storage} onSelect={setStorage} />

                <Text style={st.label}>RAM{ramRequired ? ' *' : ''}</Text>
                <ChipSet options={ramOptions} selected={ram} onSelect={setRam} />
              </>
            ) : (
              <>
                {isOther ? (
                  <View style={st.confirmBox}>
                    <Text style={st.confirmTitle}>Unsupported category fallback</Text>
                    <Text style={st.confirmText}>
                      Owmee will list this as Other. Keep the AI-filled details or edit them before publishing.
                    </Text>
                  </View>
                ) : null}

                <Text style={st.label}>Listing title{isOther ? ' *' : ''}</Text>
                <TextInput
                  style={st.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="What are you selling?"
                  placeholderTextColor={C.text4}
                  autoCapitalize="words"
                  maxLength={80}
                />

                <SuggestionField
                  label="Brand"
                  value={brand}
                  onChangeText={setBrand}
                  placeholder="Apple, Samsung, HP..."
                  suggestions={brandOptions}
                />

                <SuggestionField
                  label="Model"
                  value={model}
                  onChangeText={setModel}
                  placeholder="Exact model or product name"
                  suggestions={modelOptions}
                />
              </>
            )}

            <Text style={st.label}>Colour</Text>
            <ChipSet options={COLOR_OPTIONS} selected={color} onSelect={setColor} />

            <TouchableOpacity
              style={st.moreToggle}
              onPress={() => setMoreOpen(!moreOpen)}
              activeOpacity={0.8}
            >
              <Text style={st.moreToggleText}>
                {moreOpen ? 'Hide extra details' : 'Add extra details'}
              </Text>
              <Text style={st.moreToggleIcon}>{moreOpen ? '-' : '+'}</Text>
            </TouchableOpacity>

            {moreOpen ? (
              <View style={st.moreBlock}>
                {isElectronic ? (
                  <>
                    <Text style={st.label}>Processor / chip</Text>
                    <ChipSet options={PROCESSOR_OPTIONS} selected={processor} onSelect={setProcessor} />

                    <Text style={st.label}>Screen size</Text>
                    <ChipSet options={SCREEN_SIZE_OPTIONS} selected={screenSize} onSelect={setScreenSize} />
                  </>
                ) : null}

                <Text style={st.label}>Purchase year</Text>
                <TextInput
                  style={st.input}
                  value={purchaseYear}
                  onChangeText={(v) => setPurchaseYear(v.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="e.g. 2024"
                  placeholderTextColor={C.text4}
                  keyboardType="numeric"
                  maxLength={4}
                />

                <Text style={st.label}>Included items</Text>
                <TextInput
                  style={st.input}
                  value={accessories}
                  onChangeText={setAccessories}
                  placeholder="Box, charger, case, bill..."
                  placeholderTextColor={C.text4}
                />

                <Text style={st.label}>Warranty</Text>
                <TextInput
                  style={st.input}
                  value={warrantyStatus}
                  onChangeText={setWarrantyStatus}
                  placeholder="No warranty, active till Dec 2026..."
                  placeholderTextColor={C.text4}
                />
              </View>
            ) : null}
          </ScrollView>

          {requiredMissing.length > 0 ? (
            <Text style={st.requiredHint}>
              Select {requiredMissing.join(', ')} to save.
            </Text>
          ) : null}
          <View style={st.ctaRow}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              style={st.cancelBtn}
            />
            <Button
              label="Save"
              variant="primary"
              disabled={requiredMissing.length > 0}
              onPress={() => onSave({
                title: title.trim(),
                brand,
                model,
                storage: findCatalogOption(storage, storageOptions) || storage,
                ram: findCatalogOption(ram, ramOptions) || ram,
                processor,
                screen_size: screenSize,
                color,
                purchase_year: /^\d{4}$/.test(purchaseYear) ? parseInt(purchaseYear, 10) : null,
                accessories,
                warranty_status: warrantyStatus,
                category_slug: canonicalCategorySlug(category_slug),
              })}
              style={st.saveBtn}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function OptionChips({
  label,
  required = false,
  options,
  selected,
  onSelect,
  emptyText,
}: {
  label: string;
  required?: boolean;
  options: string[];
  selected: string;
  onSelect: (next: string) => void;
  emptyText?: string;
}) {
  return (
    <View>
      <Text style={st.label}>{label}{required ? ' *' : ''}</Text>
      {options.length > 0 ? (
        <ChipSet options={options} selected={selected} onSelect={onSelect} />
      ) : (
        <Text style={st.emptyHint}>{emptyText || 'Select another option first.'}</Text>
      )}
    </View>
  );
}

function ChipSet({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (next: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? options : options.slice(0, 8);

  return (
    <View style={st.chipRow}>
      {visible.map((s) => (
        <TouchableOpacity
          key={s}
          onPress={() => onSelect(selected === s ? '' : s)}
          style={[st.chip, selected === s && st.chipActive]}>
          <Text style={[st.chipText, selected === s && st.chipTextActive]}>
            {s}
          </Text>
        </TouchableOpacity>
      ))}
      {options.length > 8 ? (
        <TouchableOpacity
          onPress={() => setExpanded(!expanded)}
          style={st.chipMore}
        >
          <Text style={st.chipMoreText}>{expanded ? 'Less' : `More ${options.length - 8}`}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SuggestionField({
  label,
  value,
  onChangeText,
  placeholder,
  suggestions,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  suggestions: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const query = value.trim().toLowerCase();
  const unique = Array.from(new Set(suggestions));
  const filtered = query ? unique.filter((item) => item.toLowerCase().includes(query)) : unique;
  const visible = expanded ? filtered : filtered.slice(0, 8);

  return (
    <View>
      <Text style={st.label}>{label}</Text>
      <TextInput
        style={st.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        autoCapitalize="words"
      />
      {visible.length > 0 ? (
        <View style={st.chipRow}>
          {visible.map((item) => (
            <TouchableOpacity
              key={item}
              onPress={() => onChangeText(item)}
              style={[st.chip, value.trim().toLowerCase() === item.toLowerCase() && st.chipActive]}
            >
              <Text style={[st.chipText, value.trim().toLowerCase() === item.toLowerCase() && st.chipTextActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          ))}
          {filtered.length > 8 ? (
            <TouchableOpacity
              onPress={() => setExpanded(!expanded)}
              style={st.chipMore}
            >
              <Text style={st.chipMoreText}>{expanded ? 'Less' : `More ${filtered.length - 8}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    padding: S.lg,
    paddingBottom: S.xxl,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: S.md,
  },
  title: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.lg,
  },
  confirmBox: {
    marginTop: S.lg,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  confirmTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.petrolDeep,
  },
  confirmText: {
    marginTop: 2,
    fontSize: T.size.sm,
    color: C.petrolText,
    lineHeight: T.size.sm + 4,
  },
  sectionTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.xs,
  },
  label: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
    marginTop: S.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bone,
  },
  chipActive: { backgroundColor: C.petrolLight, borderColor: C.petrol },
  chipText: { color: C.text2, fontSize: T.size.base, fontWeight: T.weight.medium },
  chipTextActive: { color: C.petrolText, fontWeight: T.weight.bold },
  chipMore: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.bone2,
  },
  chipMoreText: {
    color: C.text2,
    fontSize: T.size.base,
    fontWeight: T.weight.semi,
  },
  emptyHint: {
    color: C.text3,
    fontSize: T.size.base,
    lineHeight: T.size.base + 4,
  },
  requiredHint: {
    marginTop: S.md,
    color: C.red,
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: Platform.OS === 'ios' ? S.md : S.sm,
    fontSize: T.size.md,
    color: C.text,
    backgroundColor: C.bone,
  },
  scroll: { maxHeight: 460 },
  moreToggle: {
    marginTop: S.lg,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moreToggleText: {
    color: C.petrolDeep,
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
  },
  moreToggleIcon: {
    color: C.petrolDeep,
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
  },
  moreBlock: {
    marginTop: S.sm,
    paddingTop: S.xs,
  },
  ctaRow: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
  cancelBtn: { flex: 1 },
  saveBtn: { flex: 2 },
});
