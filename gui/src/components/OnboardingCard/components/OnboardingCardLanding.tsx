import { useContext } from "react";
import { Button, SecondaryButton } from "../..";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { selectCurrentOrg } from "../../../redux/slices/profilesSlice";
import { selectFirstHubProfile } from "../../../redux/thunks/selectFirstHubProfile";
import { useOnboardingCard } from "../hooks/useOnboardingCard";

export function OnboardingCardLanding({
  onSelectConfigure,
  isDialog,
}: {
  onSelectConfigure: () => void;
  isDialog?: boolean;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const onboardingCard = useOnboardingCard();
  const auth = useAuth();
  const currentOrg = useAppSelector(selectCurrentOrg);
  const dispatch = useAppDispatch();

  function onGetStarted() {
    void auth.login(true).then((success) => {
      if (success) {
        onboardingCard.close(isDialog);

        // A new assistant is created when the account is created
        // We want to switch to this immediately
        void dispatch(selectFirstHubProfile());

        ideMessenger.post("showTutorial", undefined);
        ideMessenger.post("showToast", ["info", "🎉 Welcome to AI Firewall!"]);
      }
    });
  }

  function openBillingPage() {
    ideMessenger.post("controlPlane/openUrl", {
      path: "settings/billing",
      orgSlug: currentOrg?.slug,
    });
    onboardingCard.close(isDialog);
  }

  return (
    <div className="xs:px-0 flex w-full max-w-full flex-col items-center justify-center px-4 text-center">
      <div className="xs:flex hidden">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-2">
          <span className="text-primary-foreground text-2xl font-bold">AF</span>
        </div>
      </div>

      <p className="mb-5 mt-0 w-full text-sm">
        Configure AI Firewall to get started with secure AI-powered coding
      </p>

      <Button
        onClick={onGetStarted}
        className="mt-4 grid w-full grid-flow-col items-center gap-2"
      >
        Get Started
      </Button>

      <SecondaryButton onClick={onSelectConfigure} className="w-full">
        Or, configure your own models
      </SecondaryButton>
    </div>
  );
}
