"""Verification orchestration.

This module owns Owmee's provider-neutral trust backbone. Product code should
ask this module whether a user can perform a trust-sensitive action instead of
calling MSG91, Bureau, or a KYC provider directly.
"""
