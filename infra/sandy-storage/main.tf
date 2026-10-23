terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}
variable "project_id" { type = string }
variable "region" { type = string, default = "europe-west1" }
variable "environment" { type = string, default = "production" }
provider "google" { project = var.project_id; region = var.region }
resource "google_project_service" "storage" {
  project = var.project_id
  service = "storage.googleapis.com"
  disable_on_destroy = false
}
locals {
  buckets = {
    clients = { suffix = "client-private", retention_days = 0, versioning = true }
    meetings = { suffix = "meeting-private", retention_days = 0, versioning = true }
    quarantine = { suffix = "quarantine", retention_days = 7, versioning = false }
    artifacts = { suffix = "system-artifacts", retention_days = 0, versioning = true }
  }
}
resource "google_storage_bucket" "sandy" {
  for_each = local.buckets
  project = var.project_id
  name = "${var.project_id}-sandy-${var.environment}-${each.value.suffix}"
  location = var.region
  storage_class = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention = "enforced"
  force_destroy = false
  labels = { service = "sandy", environment = var.environment, purpose = each.key }
  versioning { enabled = each.value.versioning }
  soft_delete_policy { retention_duration_seconds = 604800 }
  dynamic "lifecycle_rule" {
    for_each = each.key == "quarantine" ? [1] : []
    content {
      action { type = "Delete" }
      condition { age = 7 }
    }
  }
  depends_on = [google_project_service.storage]
}
resource "google_service_account" "file_service" {
  project = var.project_id
  account_id = "sandy-file-service"
  display_name = "Sandy private file service (no user keys)"
}
resource "google_storage_bucket_iam_member" "file_objects" {
  for_each = { for k,v in google_storage_bucket.sandy : k => v if k != "quarantine" }
  bucket = each.value.name
  role = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.file_service.email}"
}
resource "google_service_account" "scanner" {
  project = var.project_id
  account_id = "sandy-file-scanner"
  display_name = "Sandy quarantine scanner"
}
resource "google_storage_bucket_iam_member" "scanner_quarantine" {
  bucket = google_storage_bucket.sandy["quarantine"].name
  role = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.scanner.email}"
}
output "bucket_names" { value = { for k,v in google_storage_bucket.sandy : k => v.name } }
output "file_service_identity" { value = google_service_account.file_service.email }
output "scanner_identity" { value = google_service_account.scanner.email }
