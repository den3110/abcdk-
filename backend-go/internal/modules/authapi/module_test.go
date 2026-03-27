package authapi

import (
	"context"
	"testing"

	"backendgo/internal/infra/auth"
	"backendgo/internal/modules/systemsettings"
)

type fakeSettingsRepository struct {
	doc *systemsettings.Document
	err error
}

func (f fakeSettingsRepository) GetOrCreate(context.Context) (*systemsettings.Document, error) {
	return f.doc, f.err
}

func TestVerifyPayloadBuildsRoleSet(t *testing.T) {
	service := NewService(fakeSettingsRepository{})
	payload := service.VerifyPayload(&auth.User{
		Name:         "Admin",
		Email:        "admin@example.com",
		Role:         "admin",
		Roles:        []string{"referee", "admin"},
		IsSuperUser:  true,
		IsSuperAdmin: true,
	})

	roles, ok := payload["roles"].([]string)
	if !ok {
		t.Fatalf("expected roles slice, got %T", payload["roles"])
	}

	expected := []string{"admin", "referee", "superadmin", "superuser"}
	if len(roles) != len(expected) {
		t.Fatalf("expected %d roles, got %d", len(expected), len(roles))
	}
	for index, role := range expected {
		if roles[index] != role {
			t.Fatalf("expected role %q at index %d, got %q", role, index, roles[index])
		}
	}
}

func TestRegistrationAndOTASettingsUseDefaults(t *testing.T) {
	service := NewService(fakeSettingsRepository{
		doc: &systemsettings.Document{ID: "system"},
	})

	registrationPayload, err := service.RegistrationSettings(context.Background())
	if err != nil {
		t.Fatalf("registration settings: %v", err)
	}
	if registrationPayload["open"] != true {
		t.Fatalf("expected registration open default true, got %#v", registrationPayload["open"])
	}
	if registrationPayload["requireOptionalProfileFields"] != true {
		t.Fatalf("expected requireOptionalProfileFields default true, got %#v", registrationPayload["requireOptionalProfileFields"])
	}

	otaPayload, err := service.OTAAllowed(context.Background())
	if err != nil {
		t.Fatalf("ota settings: %v", err)
	}
	if otaPayload["allowed"] != false {
		t.Fatalf("expected ota allowed default false, got %#v", otaPayload["allowed"])
	}
}
